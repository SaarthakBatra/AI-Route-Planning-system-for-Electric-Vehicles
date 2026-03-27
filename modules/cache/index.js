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
        logger.info(`Health check result: ${pong}`);
        logger.done('runHealthCheck', `Redis responded: ${pong}`);

        // Graceful disconnect
        logger.info('Health check complete. Disconnecting from Redis...');
        await client.quit();
        logger.info('Redis disconnected cleanly.');
    } catch (err) {
        logger.error(`Health check FAILED | error: ${err.message}`);
        logger.error('Ensure Redis is running and REDIS_HOST / REDIS_PORT in .env are correct.');
        process.exitCode = 1;
    }
};

runHealthCheck();
