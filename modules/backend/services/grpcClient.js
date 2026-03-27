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
        
        client.CalculateRoute(routeRequest, (error, response) => {
            if (error) {
                logger.error(`gRPC CalculateRoute failed: ${error.message}`);
                return reject(error);
            }
            resolve(response);
        });
    });
};

module.exports = {
    client,
    calculateRouteGrpc
};
