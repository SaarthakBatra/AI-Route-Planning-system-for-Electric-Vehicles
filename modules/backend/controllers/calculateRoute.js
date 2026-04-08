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
const { validateEvParams } = require('../utils/validation');
const { getVehicleProfile } = require('../services/evProfiles');

/**
 * Maps a raw gRPC algorithm result to the standardized client-facing schema.
 * Enforces the "Failure Signature" (1,000,001 nodes) if a circuit breaker was triggered.
 * Detects Native C++ I/O truncation and appends a directory pointer.
 * 
 * @param {Object} res - The raw response from gRPC
 * @param {number} maxNodes - The maximum node limit from environment
 * @param {string} logDir - Current request session directory for log linking
 * @param {number} effectiveCapacityKwh - Vehicle battery capacity for percentage calculation
 * @returns {Object} Standardized result object
 */
const mapAlgoResult = (res, maxNodes, logDir, effectiveCapacityKwh) => {
    const isBreakerHit = res.circuit_breaker_triggered || res.nodes_expanded > maxNodes;
    let debugLogs = res.debug_logs || '';
    
    // v2.3.0: Detect Native C++ I/O truncation marker
    if (debugLogs.includes('(TRUNCATED: Native I/O...)')) {
        debugLogs += `\n\n[NOTICE] Granular logging offloaded to Direct I/O for performance. Full trace available on-disk at: Output/${logDir}/Algo_${res.algorithm}.md`;
    }
    
    return {
        algorithm: res.algorithm,
        polyline: isBreakerHit ? [] : (res.polyline || []).map(coord => ({
            lat: coord.lat,
            lng: coord.lng,
            segment_consumed_kwh: coord.segment_consumed_kwh || 0,
            is_charging_stop: !!coord.is_charging_stop,
            is_regen: !!coord.is_regen,
            charger_type: coord.charger_type || 'NONE',
            kw_output: coord.kw_output || 0,
            is_operational: coord.is_operational !== false,
            planned_soc_kwh: coord.planned_soc_kwh || 0,
            planned_soc_pct: effectiveCapacityKwh > 0 ? (coord.planned_soc_kwh / effectiveCapacityKwh) * 100 : 0
        })),
        distance: isBreakerHit ? 0 : (res.distance || 0),
        duration: isBreakerHit ? 0 : (res.duration || 0),
        nodes_expanded: isBreakerHit ? (maxNodes + 1) : (res.nodes_expanded || 0),
        exec_time_ms: res.exec_time_ms || 0,
        path_cost: isBreakerHit ? 0 : (res.path_cost || 0),
        circuit_breaker_triggered: !!isBreakerHit,
        debug_logs: debugLogs,
        // NEW (Stage 5): EV Metrics
        arrival_soc_kwh: res.arrival_soc_kwh || 0,
        arrival_soc_pct: effectiveCapacityKwh > 0 ? (res.arrival_soc_kwh / effectiveCapacityKwh) * 100 : 0,
        consumed_kwh: res.consumed_kwh || 0,
        is_charging_stop: !!res.is_charging_stop
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

            // Stage 5: EV Parameter Extraction & Validation
            let ev_params = null;
            let effectiveCapacityKwh = 0;
            const evInput = req.body.ev_params || req.body; // Support both nested and flat for backward compatibility
            
            // Check for explicit EV intent or presence of identifying parameters
            if (evInput.enabled || evInput.ev_routing || evInput.vehicle_id || evInput.payload_kg !== undefined || 
                evInput.target_charge_bound_kwh !== undefined || evInput.is_emergency_assumption !== undefined) {
                const { error, value } = validateEvParams(evInput);
                if (error) {
                    logger.error(`[BACKEND] [VALIDATION_ERROR] Invalid EV Parameters: ${error.message}`);
                    return errorResponse(res, 400, `Invalid EV Parameters: ${error.message}`);
                }

                // Step 1: Resolve Profile (Standard EV as mandatory fallback for non-blocking execution)
                const vehicleProfileId = value.vehicle_id || 'standard_ev';
                const vehicle = getVehicleProfile(vehicleProfileId);
                
                if (!vehicle) {
                    return errorResponse(res, 400, `Vehicle profile not found: ${vehicleProfileId}`);
                }

                logger.info(`[BACKEND] Using EV Profile: ${vehicleProfileId}`);

                // Resale Validation: Protection against abusive inputs
                if (vehicle.capacity_kwh > 500) {
                    return errorResponse(res, 400, 'Battery capacity exceeds system limits (500kWh).');
                }

                // Step 2: Mass & Energy Resolution (Physics-First Priority)
                // Use effective_mass_kg override if provided; else derived from Tare + Payload
                const effective_mass_kg = value.effective_mass_kg || (vehicle.mass_kg + value.payload_kg);
                effectiveCapacityKwh = vehicle.capacity_kwh * (value.battery_soh_pct / 100);
                
                // Use start_soc_kwh override if provided; else derived from Percent calculation
                const start_soc_kwh = (value.start_soc_kwh !== undefined) ? value.start_soc_kwh : (effectiveCapacityKwh * (value.start_soc_pct / 100));

                // Step 3: Construct EVParams with Override Priority (Mission > Profile > Schema Defaults)
                ev_params = {
                    enabled: true,
                    effective_mass_kg,
                    Crr: value.rolling_resistance_coeff || vehicle.rolling_resistance_coeff || 0.012,
                    wheel_radius_m: value.wheel_radius_m || vehicle.wheel_radius_m || 0.35,
                    ac_kw_max: vehicle.ac_kw_max,
                    dc_kw_max: vehicle.dc_kw_max,
                    max_regen_power_kw: vehicle.max_regen_power_kw,
                    energy_uncertainty_margin_pct: value.energy_uncertainty_margin_pct || parseInt(process.env.ENERGY_UNCERTAINTY_MARGIN_PCT) || 5,
                    battery_soh_pct: value.battery_soh_pct,
                    start_soc_kwh,
                    min_waypoint_soc_kwh: effectiveCapacityKwh * (value.min_waypoint_soc_pct / 100),
                    min_arrival_soc_kwh: effectiveCapacityKwh * (value.min_arrival_soc_pct / 100),
                    target_charge_bound_kwh: (value.target_charge_bound_kwh !== undefined) ? value.target_charge_bound_kwh : (effectiveCapacityKwh * (value.target_charge_bound_pct / 100)),
                    is_emergency_assumption: !!value.is_emergency_assumption,
                    drag_coeff: value.drag_coeff || vehicle.drag_coeff || 0.26,
                    frontal_area_m2: value.frontal_area_m2 || vehicle.frontal_area_m2 || 2.3,
                    regen_efficiency: value.regen_efficiency || vehicle.regen_efficiency || 0.75,
                    aux_power_kw: value.aux_power_kw || vehicle.aux_power_kw || 1.0
                };

                logger.info(`[BACKEND] [EV_ORCHESTRATION] Mode: ${value.effective_mass_kg ? 'Custom' : 'Profile'} | Mass: ${effective_mass_kg}kg | Start SoC: ${start_soc_kwh.toFixed(1)}kWh`);
            }

            logger.info(`Calculating route suite (Protobuf Mode) from (${start.lat}, ${start.lng}) to (${end.lat}, ${end.lng}) [Hour: ${validatedHour}, Obj: ${validatedObjective}]`);
            
            // Sync Search Limits & Diagnostics
            const maxNodes = parseInt(process.env.ALGO_MAX_NODES) || 10000000;
            let socStep = parseFloat(process.env.SOC_DISCRETIZATION_STEP) || 0.1;
            if (socStep <= 0) socStep = 0.1; // Safety clamp for engine stability
            
            // v2.3.0 C++ Native logging/watchdog parameters
            const killTimeMs = parseInt(process.env.ALGO_KILL_TIME_MS) || 60000;
            const debugNodeInterval = parseInt(process.env.ALGO_DEBUG_NODE_INTERVAL) || 5000;

            const epsilonMin = parseFloat(process.env.ROUTING_EPSILON_MIN) || 10.0;
            const bandingShortest = parseFloat(process.env.ROUTING_IDA_BANDING_SHORTEST) || 10.0;
            const bandingFastest = parseFloat(process.env.ROUTING_IDA_BANDING_FASTEST) || 1.0;

            // Legacy Diagnostic Parameters (For Backward Compatibility)
            const debugLogCap = parseInt(process.env.ROUTING_DEBUG_LOG_CAP) || 1000000;
            const logFlushNodes = parseInt(process.env.ROUTING_LOG_FLUSH_NODES) || 500000;
            const logFlushInterval = parseInt(process.env.ROUTING_LOG_FLUSH_INTERVAL) || 5;
            const logInterval = parseInt(process.env.ROUTING_LOG_INTERVAL) || 250000;

            const debugMode = process.env.ENGINE_SIMULATOR === 'true';
            const algoDebug = process.env.ALGO_DEBUG === 'true';

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
                logger.debug("[BACKEND] Final gRPC EV Params: " + JSON.stringify(ev_params));
                grpcResponse = await calculateRouteGrpc({
                    start,
                    end,
                    mockHour: validatedHour,
                    objective: validatedObjective,
                    mapDataPb,
                    regionId,
                    evParams: ev_params,
                    maxNodes,
                    socStep,
                    killTimeMs,
                    debugNodeInterval,
                    epsilonMin,
                    bandingShortest,
                    bandingFastest,
                    debugLogCap,
                    logFlushNodes,
                    logFlushInterval,
                    logInterval,
                    algoDebug,
                    debugMode
                });
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
            const responseData = {
                success: true,
                data: {
                    results: (grpcResponse.results || []).map(r => mapAlgoResult(r, maxNodes, logDir, effectiveCapacityKwh))
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
