/**
 * @file grpcClient.js
 * @module backend/services/grpcClient
 * @description High-performance gRPC client for communication with the Routing Engine.
 * Configures payload limits, shared logging metadata, and dynamic endpoint resolution via env.
 * 
 * @workflow
 * 1. Initialize gRPC connection to Routing Engine C++/Python server.
 * 2. Configure maximum message size (Default: 50MB) for OSM JSON payloads.
 * 3. Wrap CalculateRoute call in a Promise for async/await support.
 * 4. Inject Request Context (logDir, logTimestamp) into gRPC metadata.
 * 5. Handle stream-based errors and map response to controller.
 * 
 * @param {string} ROUTING_ENGINE_URL - Target server address (env: localhost:50051)
 * @param {number} GRPC_MAX_MESSAGE_SIZE - Payload limit (env: 52428800)
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
 * Calls the CalculateRoute gRPC method.
 * @param {Object} start - { lat, lng }
 * @param {Object} end - { lat, lng }
 * @param {number} mock_hour - 0-23
 * @param {string} objective - 'FASTEST' | 'SHORTEST'
 * @param {string} map_data - Stringified OSM JSON from cache
 * @returns {Promise<Object>} The RouteResponse object containing a results array
 */
const calculateRouteGrpc = (start, end, mock_hour = 12, objective = 'FASTEST', map_data = '') => {
    return new Promise((resolve, reject) => {
        const routeRequest = { 
            start, 
            end, 
            mock_hour, 
            objective,
            map_data
        };
        
        // Step 3: Trigger the full search suite
        const metadata = new grpc.Metadata();
        metadata.add('use-suite', 'true');
        
        const store = storage.getStore();
        if (store && store.logDir) {
            metadata.add('log-dir', store.logDir);
            metadata.add('log-timestamp', store.logTimestamp.toString());
        }

        logger.debug('Initiating gRPC CalculateRoute call (Suite Mode)', { 
            target, 
            request: { ...routeRequest, map_data: map_data ? `${map_data.substring(0, 100)}...` : 'EMPTY' },
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
