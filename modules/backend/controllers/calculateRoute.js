const errorResponse = require('../utils/errorResponse');
const logger = require('../utils/logger');

/**
 * Validates the start and end coordinates, and responds with test data.
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

        // Dummy data for Step 1 pipeline verification.
        const dummyPath = [
            { lat: start.lat, lng: start.lng },
            { lat: (start.lat + end.lat) / 2, lng: ((start.lng + end.lng) / 2) + 0.1 },
            { lat: end.lat, lng: end.lng }
        ];

        return res.status(200).json({
            success: true,
            data: {
                path: dummyPath
            }
        });
    } catch (error) {
        logger.error(`Error in calculateRouteController: ${error.message}`);
        return errorResponse(res, 500, 'Internal Server Error');
    }
};

module.exports = calculateRouteController;
