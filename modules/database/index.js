require('dotenv').config({ path: __dirname + '/.env' });

/**
 * @fileoverview Database module health-check entry point.
 *
 * Purpose: Validate that the MongoDB Atlas connection is healthy on startup.
 * Run directly with: node modules/database/index.js
 *
 * This is NOT a production server — it is a standalone diagnostic script.
 * Requires MONGO_URI to be set in modules/database/.env
 */

const { connectMongo, disconnectMongo } = require('./services/mongoClient');
const logger = require('./utils/logger');

/**
 * Runs the MongoDB health check: connect → log → disconnect.
 * @returns {Promise<void>}
 */
const runHealthCheck = async () => {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('Database Module — MongoDB Atlas Health Check Starting');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    logger.call('runHealthCheck', 'none');

    try {
        await connectMongo();
        logger.info('Health check PASSED — MongoDB Atlas connection is healthy.');
        logger.done('runHealthCheck', 'Connection successful');

        logger.info('Health check complete. Disconnecting from MongoDB...');
        await disconnectMongo();
    } catch (err) {
        logger.error(`Health check FAILED | error: ${err.message}`);
        logger.error('Ensure MONGO_URI in modules/database/.env is correctly set to your Atlas connection string.');
        process.exitCode = 1;
    }
};

runHealthCheck();
