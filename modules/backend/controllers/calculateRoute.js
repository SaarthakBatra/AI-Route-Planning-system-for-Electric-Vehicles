const errorResponse = require('../utils/errorResponse');
const logger = require('../utils/logger');
const { calculateRouteGrpc } = require('../services/grpcClient');

/**
 * Validates the start and end coordinates, and responds with the route.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const calculateRouteController = async (req, res) => {
    try {
        const { start, end } = req.body;

        if (!start || !end) {
            return errorResponse(res, 400, 'Missing start or end coordinates.');
        }

        if (typeof start.lat !== 'number' || typeof start.lng !== 'number' ||
            typeof end.lat !== 'number' || typeof end.lng !== 'number') {
            return errorResponse(res, 400, 'Coordinates must be numbers.');
        }

        logger.info(`Calculating route from (${start.lat}, ${start.lng}) to (${end.lat}, ${end.lng})`);
        logger.debug('Inbound Request Payload', { start, end });

        // Fetch precise route polyline from the Python gRPC Engine
        const grpcResponse = await calculateRouteGrpc(start, end);

        // Standardized Step 2 Response: Routes Array Interface
        // Wrapping in data.routes array to support future alternative paths (Step 4)
        const responseData = {
            success: true,
            data: {
                routes: [
                    {
                        path: grpcResponse.polyline || [],
                        distance: grpcResponse.distance || 0,
                        duration: grpcResponse.duration || 0
                    }
                ]
            }
        };

        logger.debug('Outbound Standardized Response', responseData);

        return res.status(200).json(responseData);
    } catch (error) {
        logger.error(`Error in calculateRouteController: ${error.message}`);
        return errorResponse(res, 500, 'Internal Server Error');
    }
};

module.exports = calculateRouteController;
