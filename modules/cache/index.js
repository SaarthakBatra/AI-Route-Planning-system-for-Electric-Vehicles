const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

/**
 * @fileoverview Cache Module Health-Check & Diagnostic Entry Point.
 *
 * Workflow:
 *  1. Environment Sync: Loads module-level .env for Redis and OSM configurations.
 *  2. Connection Probe: Pings the Redis/Valkey instance to verify availability.
 *  3. Functional Test: Triggers a tiny area fetch from the Overpass API to verify
 *     network connectivity and Protobuf serialization integrity.
 *  4. Lifecycle Management: Disconnects the Redis client gracefully regardless of 
 *     success or failure to prevent hanging processes.
 *
 * Usage: node modules/cache/index.js
 */

const { client, pingRedis } = require('./services/redisClient');
const { getMapPayload } = require('./services/osmWorker');
const database = require('../database');
const logger = require('./utils/logger');

/**
 * Runs the Redis health check: connect → ping → disconnect.
 * @returns {Promise<void>}
 */
const runHealthCheck = async () => {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('Cache Module — Redis Health Check Starting');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    logger.call('runHealthCheck', 'none');

    try {
        // Ping the server

        const pong = await pingRedis();
        logger.info(`Redis check result: ${pong}`);

        // ─── OSM Worker Diagnostic ─────────────────────────────────────────────
        logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        logger.info('Cache Module — OSM Worker Health Check');
        logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        // Connect to MongoDB Atlas for OCM triage logic
        await database.connectMongo();

        // London tiny sample bbox
        const dummyBbox = { minLat: 51.500, minLon: -0.100, maxLat: 51.501, maxLon: -0.099 };
        const { binary, region_id } = await getMapPayload(dummyBbox);
        const dataSize = binary.length;
        
        logger.info(`OSM Worker check result: ${dataSize} bytes received [Protobuf]`);
        logger.info(`Region ID generated: ${region_id}`);
        logger.done('runHealthCheck', `Redis: ${pong} | PB: ${dataSize}B`);

        logger.info('Health checks complete.');
    } catch (err) {
        logger.error(`Health check FAILED | error: ${err.message}`);
        logger.error('Ensure Redis is running and OSM API is accessible.');
        process.exitCode = 1;
    } finally {
        if (client && client.status !== 'end') {
            logger.info('Disconnecting Redis client in finally block...');
            await client.quit();
            logger.info('Redis disconnected.');
        }

        // Ensure MongoDB is disconnected to prevent process hanging
        try {
            await database.disconnectMongo();
            logger.info('MongoDB disconnected.');
        } catch (err) {
            // Silently fail if already disconnected
        }
    }
};

runHealthCheck();
