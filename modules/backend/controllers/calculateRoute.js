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
 * 5. Dispatch async gRPC call with 'use-suite' metadata.
 * 6. Transform gRPC results to standardized REST JSON schema.
 * 7. Flush buffered logs and unregister request context.
 * 
 * @param {import('express').Request} req - Express request with {start, end, mock_hour, objective}
 * @param {import('express').Response} res - Express response with standardized AlgorithmResults
 */
const errorResponse = require('../utils/errorResponse');
const logger = require('../utils/logger');
const { calculateRouteGrpc } = require('../services/grpcClient');
const { getMapData } = require('../../cache/services/osmWorker');
const { calculateBBox } = require('../utils/bbox');
const { storage, registerContext, unregisterContext } = require('../utils/context');
const { getAndIncrementUID } = require('../utils/uid');

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

            logger.info(`Calculating route suite from (${start.lat}, ${start.lng}) to (${end.lat}, ${end.lng}) [Hour: ${validatedHour}, Obj: ${validatedObjective}]`);
            
            // Step 4: Dynamic OSM Ingestion with Graceful Fallback
            let mapDataString = '';
            try {
                const bbox = calculateBBox(start, end);
                const mapData = await getMapData(bbox);
                
                if (mapData && mapData.elements && mapData.elements.length > 0) {
                    mapDataString = JSON.stringify(mapData);
                    const sizeKB = (Buffer.byteLength(mapDataString) / 1024).toFixed(0);
                    logger.info(`[BACKEND] [INFO] Map Ingestion Triggered | Ingested: ${sizeKB}KB`);
                }
            } catch (osmError) {
                logger.warn(`[BACKEND] [WARN] Map Ingestion Failed | Falling back to static mode: ${osmError.message}`);
            }

            // Trigger 5-algorithm search via gRPC
            const grpcResponse = await calculateRouteGrpc(start, end, validatedHour, validatedObjective, mapDataString);

            // Step 3 Standardized Response: Results Array Interface
            const responseData = {
                success: true,
                data: {
                    results: (grpcResponse.results || []).map(res => ({
                        algorithm: res.algorithm,
                        polyline: res.polyline || [],
                        distance: res.distance || 0,
                        duration: res.duration || 0,
                        nodes_expanded: res.nodes_expanded || 0,
                        exec_time_ms: res.exec_time_ms || 0,
                        path_cost: res.path_cost || 0
                    }))
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
