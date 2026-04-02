const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const logger = require('../utils/logger');

const PROTO_PATH = path.resolve(__dirname, '../../routing_engine/proto/route_engine.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});

const route_engine = grpc.loadPackageDefinition(packageDefinition).route_engine;

// The Python gRPC server is running on localhost:50051
const target = 'localhost:50051';
const client = new route_engine.RouteService(target, grpc.credentials.createInsecure());

/**
 * Calls the CalculateRoute gRPC method.
 * @param {Object} start - { lat, lng }
 * @param {Object} end - { lat, lng }
 * @param {number} mock_hour - 0-23
 * @param {string} objective - 'FASTEST' | 'SHORTEST'
 * @returns {Promise<Object>} The RouteResponse object containing a results array
 */
const calculateRouteGrpc = (start, end, mock_hour = 12, objective = 'FASTEST') => {
    return new Promise((resolve, reject) => {
        const routeRequest = { 
            start, 
            end, 
            mock_hour, 
            objective 
        };
        
        // Step 3: Trigger the full search suite
        const metadata = new grpc.Metadata();
        metadata.add('use-suite', 'true');

        logger.debug('Initiating gRPC CalculateRoute call (Suite Mode)', { 
            target, 
            request: routeRequest,
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
