const errorResponse = require('../utils/errorResponse');
const logger = require('../utils/logger');
const { calculateRouteGrpc } = require('../services/grpcClient');

/**
 * Validates the start and end coordinates, and responds with the comparison suite.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const calculateRouteController = async (req, res) => {
    try {
        const { start, end, mock_hour, objective } = req.body;

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
        logger.debug('Inbound Request Payload', { start, end, mock_hour: validatedHour, objective: validatedObjective });

        // Trigger 5-algorithm search via gRPC
        const grpcResponse = await calculateRouteGrpc(start, end, validatedHour, validatedObjective);

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
    }
};

module.exports = calculateRouteController;
