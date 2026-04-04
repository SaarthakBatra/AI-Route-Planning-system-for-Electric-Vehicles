const path = require('path');
// Load environment variables from the module-local .env and root .env for maximum flexibility
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

/**
 * @fileoverview Database module health-check entry point.
 *
 * PURPOSE:
 * Validate that the MongoDB Atlas connection is healthy on startup. This script acts 
 * as a tracer bullet for the persistence layer.
 * 
 * RUN DIRECTLY WITH: node modules/database/index.js
 * 
 * WORKFLOW:
 * 1. Initialize diagnostic tracers.
 * 2. Attempt connection to MongoDB Atlas via mongoClient.
 * 3. Log success/failure metrics.
 * 4. Gracefully disconnect.
 *
 * REQUIRES MONGO_URI to be set in modules/database/.env or root .env
 */

const { connectMongo, disconnectMongo } = require('./services/mongoClient');
const logger = require('./utils/logger');

/**
 * Executes the MongoDB health check sequence: connect → verify → disconnect.
 * 
 * STAGES:
 * - Initialization: Logs a visual separator and start message.
 * - Connection: Calls connectMongo() which handles authentication and timeout logic.
 * - Validation: Confirms reachability by logging a 'PASSED' message.
 * - Cleanup: Closes the connection to avoid process hanging.
 *
 * @async
 * @returns {Promise<void>}
 */
const runHealthCheck = async () => {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('Database Module — MongoDB Atlas Health Check Starting');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    logger.call('runHealthCheck', 'none');

    try {
        const readyState = await connectMongo();
        logger.info(`Health check PASSED — ReadyState: ${readyState}`);
        logger.done('runHealthCheck', 'Connection successful');

        logger.info('Health check complete. Disconnecting from MongoDB...');
        await disconnectMongo();
    } catch (err) {
        logger.error(`Health check FAILED | error: ${err.message}`);
        logger.error('Ensure MONGO_URI in modules/database/.env or root .env is correctly set.');
        process.exitCode = 1;
    }
};

// Autostart the health check when run as a standalone script
runHealthCheck();

