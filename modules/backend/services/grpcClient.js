/**
 * @file grpcClient.js
 * @module backend/services/grpcClient
 * @description High-performance gRPC client for communication with the Routing Engine.
 * Supports binary Protobuf payloads (v2) and standardizes request metadata for tracing.
 * 
 * @workflow
 * 1. Load the RouteService definition from the proto file.
 * 2. Resolve the target Engine URL from environment variables.
 * 3. Configure the gRPC client with custom message size limits (Default: 50MB).
 * 4. Inject Request Context (logDir, logTimestamp) into gRPC metadata for cross-module tracing.
 * 5. Provide an async wrapper for the CalculateRoute call.
 * 
 * @property {string} ROUTING_ENGINE_URL - Target server address (env: localhost:50051)
 * @property {number} GRPC_MAX_MESSAGE_SIZE - Binary payload limit (env: 52428800)
 */
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const logger = require('../utils/logger');
const { storage } = require('../utils/context');

const PROTO_PATH = path.resolve(__dirname, '../../routing_engine/proto/route_engine.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});

const route_engine = grpc.loadPackageDefinition(packageDefinition).route_engine;

// Dynamic target resolution with fallback for local development
const target = process.env.ROUTING_ENGINE_URL || 'localhost:50051';

// Increase the default message limit (4MB) to 50MB to handle large OSM map data
const MAX_MESSAGE_SIZE = parseInt(process.env.GRPC_MAX_MESSAGE_SIZE) || (50 * 1024 * 1024);
const clientOptions = {
    'grpc.max_send_message_length': MAX_MESSAGE_SIZE,
    'grpc.max_receive_message_length': MAX_MESSAGE_SIZE
};

const client = new route_engine.RouteService(target, grpc.credentials.createInsecure(), clientOptions);

/**
 * Calls the CalculateRoute gRPC method using an options-object pattern.
 * @param {Object} params - Unified request and tuning parameters.
 * @param {Object} params.start - { lat, lng }
 * @param {Object} params.end - { lat, lng }
 * @param {number} [params.mockHour=12] - 0-23
 * @param {string} [params.objective='FASTEST'] - 'FASTEST' | 'SHORTEST'
 * @param {Buffer|null} [params.mapDataPb=null] - Binary-serialized MapPayload (v2)
 * @param {string} [params.regionId=''] - Geographic region identifier for C++ Graph Cache (v2)
 * @param {string} [params.mapData=''] - Stringified OSM JSON from cache (v1 - Backwards Compatible)
 * @param {Object|null} [params.evParams=null] - Physics and constraint parameters (Stage 5)
 * @param {number} [params.maxNodes=1000000] - Maximum expansion limit
 * @param {number} [params.socStep=0.1] - Energy discretization bin size
 * @param {number} [params.debugLogCap=1000000] - Granular trace limit
 * @param {number} [params.logFlushNodes=5000] - Heartbeat flush frequency (Nodes)
 * @param {number} [params.logFlushInterval=5] - Heartbeat flush frequency (Seconds)
 * @param {number} [params.epsilonMin=10.0] - Search relaxation threshold
 * @param {number} [params.bandingShortest=10.0] - Shortest-path banding factor
 * @param {number} [params.bandingFastest=1.0] - Fastest-path banding factor
 * @param {number} [params.logInterval=250000] - Node expansion frequency for heartbeat logging
 * @param {boolean} [params.algoDebug=false] - (v2.2.0) Flag to enable engine-side optimized tracing
 * @param {boolean} [params.debugMode=false] - (v2.2.0) General debug flag for verbose logging
 * @returns {Promise<Object>} The RouteResponse object
 */
const calculateRouteGrpc = (params = {}) => {
    const {
        start, end, mockHour = 12, objective = 'FASTEST',
        mapDataPb = null, regionId = '', mapData = '', evParams = null,
        maxNodes = 10000000, socStep = 0.1, killTimeMs = 60000,
        debugNodeInterval = 5000,
        epsilonMin = 10.0, bandingShortest = 10.0, bandingFastest = 1.0,
        algoDebug = false, debugMode = false
    } = params;

    return new Promise((resolve, reject) => {
        const routeRequest = { 
            start, 
            end, 
            mock_hour: mockHour, 
            objective,
            map_data: mapData,
            region_id: regionId,
            map_data_pb: mapDataPb,
            ev_params: evParams
        };
        
        const metadata = new grpc.Metadata();
        metadata.add('use-suite', 'true');
        metadata.add('max-nodes', maxNodes.toString());
        metadata.add('soc-discretization-step', socStep.toString());
        metadata.add('kill-time-ms', killTimeMs.toString());
        metadata.add('debug-node-interval', debugNodeInterval.toString());
        metadata.add('epsilon-min', epsilonMin.toString());
        metadata.add('banding-shortest', bandingShortest.toString());
        metadata.add('banding-fastest', bandingFastest.toString());
        metadata.add('algo-debug', algoDebug.toString());
        metadata.add('debug-mode', debugMode.toString());
        
        const store = storage.getStore();
        if (store && store.logDir) {
            metadata.add('log-dir', store.logDir);
            metadata.add('log-timestamp', store.logTimestamp.toString());
        }

        logger.debug('Initiating gRPC CalculateRoute call (Suite Mode)', { 
            target, 
            request: { 
                ...routeRequest, 
                map_data: mapData ? `${mapData.substring(0, 50)}...` : 'EMPTY',
                map_data_pb: mapDataPb ? `BINARY(${mapDataPb.length} bytes)` : 'EMPTY'
            },
            metadata: metadata.getMap() 
        });


        const startTime = Date.now();
        
        client.CalculateRoute(routeRequest, metadata, (error, response) => {
            const duration = Date.now() - startTime;
            
            if (error) {
                logger.error(`gRPC CalculateRoute failed after ${duration}ms: ${error.message}`);
                return reject(error);
            }

            logger.debug(`gRPC CalculateRoute succeeded in ${duration}ms`, {
                resultsCount: response.results ? response.results.length : 0,
                algorithms: response.results ? response.results.map(r => r.algorithm) : []
            });

            resolve(response);
        });
    });
};

module.exports = {
    client,
    calculateRouteGrpc
};
