const path = require('path');
// Attempt to load .env from the module directory first, then root as backup
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

/**
 * @fileoverview MongoDB client service for the Database module.
 *
 * RESPONSIBILITIES:
 *  - Establish and manage a Mongoose connection to MongoDB Atlas.
 *  - Log all connection lifecycle events (connected, disconnected, error).
 *  - Export connectMongo() and disconnectMongo() for use by the health-check and integration layers.
 *
 * DESIGN PATTERN: Singleton Connection
 * This module ensures that only one Mongoose connection is managed globally via the 
 * internal Mongoose connection state.
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

/** @type {string|undefined} - The Atlas connection string from environment variables. */
const MONGO_URI = process.env.MONGO_URI;

// ─── Connection Lifecycle Event Logging ───────────────────────────────────────

/**
 * Event listener for successful Mongoose connection.
 * Logs host information to verify correct cluster targeting.
 */
mongoose.connection.on('connected', () => {
    const host = mongoose.connection.host || 'unknown';
    logger.info(`Mongoose connected    | host: ${host}`);
});

/**
 * Event listener for Mongoose disconnection.
 * Essential for monitoring accidental dropouts or graceful shutdowns.
 */
mongoose.connection.on('disconnected', () => {
    logger.info('Mongoose disconnected');
});

/**
 * Event listener for Mongoose connection errors.
 * Critical for debugging network issues or authentication failures.
 */
mongoose.connection.on('error', (err) => {
    logger.error(`Mongoose error        | error: ${err.message}`);
});

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Establishes a Mongoose connection to MongoDB Atlas.
 *
 * WORKFLOW:
 * 1. Validates presence and format of MONGO_URI.
 * 2. Masks credentials to ensure zero sensitive data leakage in logs.
 * 3. Triggers mongoose.connect with a 5-second circuit breaker (serverSelectionTimeoutMS).
 * 4. Logs the final readyState (1 = connected).
 *
 * @async
 * @returns {Promise<number>} Returns the Mongoose readyState (1 for success).
 * @throws {Error} If MONGO_URI is missing or connection fails.
 */
const connectMongo = async () => {
    // Safety check for unconfigured environments
    if (!MONGO_URI || MONGO_URI.includes('<username>')) {
        const msg = 'MONGO_URI is not configured. Please update modules/database/.env with your Atlas connection string.';
        logger.error(msg);
        throw new Error(msg);
    }

    // Mask credentials for safe logging (replaces username/password with placeholders)
    const maskedUri = MONGO_URI.replace(/:\/\/[^@]+@/, '://<credentials>@');
    logger.call('connectMongo', `MONGO_URI: ${maskedUri}`);

    try {
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 5000, // Fail fast if unreachable
        });
        const readyState = mongoose.connection.readyState;
        logger.done('connectMongo', `readyState=${readyState}`);
        return readyState;
    } catch (err) {
        logger.error(`connectMongo failed | error: ${err.message}`);
        throw err;
    }
};

/**
 * Gracefully closes the Mongoose connection.
 *
 * WORKFLOW:
 * 1. Logs the [CALL] for tracing.
 * 2. Invokes mongoose.disconnect().
 * 3. Logs completion and returns 'Connection closed'.
 *
 * @async
 * @returns {Promise<string>} Success message.
 * @throws {Error} If disconnection fails.
 */
const disconnectMongo = async () => {
    logger.call('disconnectMongo', 'none');
    try {
        await mongoose.disconnect();
        logger.done('disconnectMongo', 'Connection closed');
        return 'Connection closed';
    } catch (err) {
        logger.error(`disconnectMongo failed | error: ${err.message}`);
        throw err;
    }
};

module.exports = {
    connectMongo,
    disconnectMongo,
};

