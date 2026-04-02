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
 * @returns {Promise<Object>} The RouteResponse object containing polyline, distance, and duration
 */
const calculateRouteGrpc = (start, end) => {
    return new Promise((resolve, reject) => {
        const routeRequest = { start, end };
        
        // Step 2 Requirement: Trigger the real Dijkstra engine via metadata
        const metadata = new grpc.Metadata();
        metadata.add('use-real-algo', 'true');

        logger.debug('Initiating gRPC CalculateRoute call', { 
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
                polylineSize: response.polyline ? response.polyline.length : 0,
                distance: response.distance,
                duration: response.duration
            });

            resolve(response);
        });
    });
};

module.exports = {
    client,
    calculateRouteGrpc
};
