/**
 * @file calculateRoute.js
 * @module backend/controllers/calculateRoute
 * @description Central controller for handling route calculation requests. 
 * Orchestrates geographic validation, dynamic OSM data ingestion from cache, 
 * and gRPC communication with the Routing Engine search suite.
 * 
 * @workflow
 * 1. Extract request parameters (start, end, hour, objective).
 * 2. Generate unique Request Identifier (UID) and log directory context.
 * 3. Validate geographic coordinates and set L3 defaults.
 * 4. Trigger BBox calculation and OSM cache ingestion (modules/cache).
 * 5. Dispatch async gRPC call with 'use-suite' metadata and semantic error mapping.
 * 6. Transform gRPC results using the mapAlgoResult helper (Standardized Failure Signature).
 * 7. Flush buffered logs and unregister request context.
 * 
 * @param {import('express').Request} req - Express request with {start, end, mock_hour, objective}
 * @param {import('express').Response} res - Express response with standardized AlgorithmResults
 */
const grpc = require('@grpc/grpc-js');
const errorResponse = require('../utils/errorResponse');
const logger = require('../utils/logger');
const { calculateRouteGrpc } = require('../services/grpcClient');
const { getMapPayload } = require('../../cache/services/osmWorker');
const { calculateBBox } = require('../utils/bbox');
const { storage, registerContext, unregisterContext } = require('../utils/context');
const { getAndIncrementUID } = require('../utils/uid');

/**
 * Maps a raw gRPC algorithm result to the standardized client-facing schema.
 * Enforces the "Failure Signature" (1,000,001 nodes) if a circuit breaker was triggered.
 * 
 * @param {Object} res - The raw response from gRPC
 * @param {number} maxNodes - The maximum node limit from environment
 * @returns {Object} Standardized result object
 */
const mapAlgoResult = (res, maxNodes) => {
    const isBreakerHit = res.circuit_breaker_triggered || res.nodes_expanded > maxNodes;
    
    return {
        algorithm: res.algorithm,
        polyline: isBreakerHit ? [] : (res.polyline || []),
        distance: isBreakerHit ? 0 : (res.distance || 0),
        duration: isBreakerHit ? 0 : (res.duration || 0),
        nodes_expanded: isBreakerHit ? (maxNodes + 1) : (res.nodes_expanded || 0),
        exec_time_ms: res.exec_time_ms || 0,
        path_cost: isBreakerHit ? 0 : (res.path_cost || 0),
        circuit_breaker_triggered: !!isBreakerHit,
        debug_logs: res.debug_logs || ''
    };
};

const calculateRouteController = (req, res) => {
    const { start, end, mock_hour, objective } = req.body;
    const logTimestamp = Date.now();
    const uid = getAndIncrementUID();

    // Construct Folder Name: <UID>_<SessionID>_<Start_Lat>_<Start_Lng>_to_<End_Lat>_<End_Lng>
    const logDir = `${uid}_${logTimestamp}_${start?.lat}_${start?.lng}_to_${end?.lat}_${end?.lng}`;

    const context = { 
        logTimestamp, 
        logDir,
        backendBuffer: [], 
        cacheBuffer: [], 
        databaseBuffer: [] 
    };
    
    registerContext(context);

    return storage.run(context, async () => {
        try {
            // Basic Coordinate Validation
            if (!start || !end) {
                return errorResponse(res, 400, 'Missing start or end coordinates.');
            }

            if (typeof start.lat !== 'number' || typeof start.lng !== 'number' ||
                typeof end.lat !== 'number' || typeof end.lng !== 'number') {
                return errorResponse(res, 400, 'Coordinates must be numbers.');
            }

            // L3 Complexity Validation/Defaults
            const validatedHour = (typeof mock_hour === 'number' && mock_hour >= 0 && mock_hour <= 23) 
                ? mock_hour 
                : 12; // Default to mid-day
            
            const validatedObjective = (objective === 'SHORTEST' || objective === 'FASTEST') 
                ? objective 
                : 'FASTEST';

            logger.info(`Calculating route suite (Protobuf Mode) from (${start.lat}, ${start.lng}) to (${end.lat}, ${end.lng}) [Hour: ${validatedHour}, Obj: ${validatedObjective}]`);
            
            // Step 4: Map Graph Persistence (Protobuf Ingestion)
            let mapDataPb = null;
            let regionId = '';
            
            try {
                const bbox = calculateBBox(start, end);
                const result = await getMapPayload(bbox);
                
                if (result && result.binary) {
                    mapDataPb = result.binary;
                    regionId = result.region_id;
                    const sizeKB = (mapDataPb.length / 1024).toFixed(0);
                    logger.info(`[BACKEND] [INFO] Protobuf Ingestion Triggered | Ingested: ${sizeKB}KB | Region: ${regionId}`);
                }
            } catch (osmError) {
                logger.error(`[BACKEND] [ERROR] Protobuf Ingestion Failed | OSM API unreachable: ${osmError.message}`);
                return errorResponse(res, 503, 'Map Data Unavailable (OSM 504). Please try again in 30 seconds.');
            }

            // Trigger 5-algorithm search via gRPC (v2 Protobuf First)
            let grpcResponse;
            try {
                grpcResponse = await calculateRouteGrpc(start, end, validatedHour, validatedObjective, mapDataPb, regionId);
            } catch (grpcErr) {
                // Semantic gRPC Error Mapping (v1.x -> v2.x)
                if (grpcErr.code === grpc.status.DEADLINE_EXCEEDED) {
                    return errorResponse(res, 504, 'Routing Engine Timeout. Request took too long to process (30s+).');
                }
                if (grpcErr.code === grpc.status.UNAVAILABLE) {
                    return errorResponse(res, 503, 'Routing Engine Unavailable. Please ensure the search suite is running.');
                }
                throw grpcErr; // Fall through to 500
            }

            // Step 3 Standardized Response: Results Array Interface
            const maxNodes = parseInt(process.env.ALGO_MAX_NODES) || 1000000;
            const responseData = {
                success: true,
                data: {
                    results: (grpcResponse.results || []).map(r => mapAlgoResult(r, maxNodes))
                }
            };

            logger.debug('Outbound Standardized Response (Suite)', { 
                resultCount: responseData.data.results.length,
                algorithms: responseData.data.results.map(r => r.algorithm)
            });

            return res.status(200).json(responseData);
        } catch (error) {
            logger.error(`Error in calculateRouteController: ${error.message}`);
            return errorResponse(res, 500, 'Internal Server Error');
        } finally {
            // Flush all buffered logs to disk
            logger.flushAllLogs();
            unregisterContext(context);
        }
    });
};

module.exports = calculateRouteController;
