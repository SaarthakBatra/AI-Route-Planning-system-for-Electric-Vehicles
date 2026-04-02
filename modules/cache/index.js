require('dotenv').config({ path: __dirname + '/.env' });

/**
 * @fileoverview Cache module health-check entry point.
 *
 * Purpose: Validate that the Redis connection is healthy on startup.
 * Run directly with: node modules/cache/index.js
 *
 * This is NOT a production server — it is a standalone diagnostic script.
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
        // Explicitly connect (lazyConnect=true means it won't auto-connect)
        logger.debug('Calling client.connect()...');
        await client.connect();

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
