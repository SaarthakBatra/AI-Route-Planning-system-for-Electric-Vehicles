require('dotenv').config({ path: __dirname + '/.env' });

/**
 * @fileoverview Cache module health-check entry point.
 *
 * Process:
 *  1. Load module-level environment variables.
 *  2. Validate Redis connectivity via PING.
 *  3. Perform a sample OSM worker fetch to verify the Overpass API.
 *  4. Disconnect and report results.
 *
 * Run directly with: node modules/cache/index.js
 */

const { client, pingRedis } = require('./services/redisClient');
const { getMapData } = require('./services/osmWorker');
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
        
        // London tiny sample bbox
        const dummyBbox = { minLat: 51.500, minLon: -0.100, maxLat: 51.501, maxLon: -0.099 };
        const data = await getMapData(dummyBbox);
        const dataSize = JSON.stringify(data).length;
        
        logger.info(`OSM Worker check result: ${dataSize} bytes received`);
        logger.done('runHealthCheck', `Redis: ${pong} | OSM: ${dataSize}B`);

        // Graceful disconnect
        logger.info('Health checks complete. Disconnecting from Redis...');
        await client.quit();
        logger.info('Redis disconnected cleanly.');
    } catch (err) {
        logger.error(`Health check FAILED | error: ${err.message}`);
        logger.error('Ensure Redis is running and OSM API is accessible.');
        if (client.status !== 'end') await client.disconnect();
        process.exitCode = 1;
    }
};

runHealthCheck();
