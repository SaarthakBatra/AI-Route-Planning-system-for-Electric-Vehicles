require('dotenv').config({ path: __dirname + '/../../.env' });

/**
 * @fileoverview MongoDB client service for the Database module.
 *
 * Responsibilities:
 *  - Establish and manage a Mongoose connection to MongoDB Atlas.
 *  - Log all connection lifecycle events (connected, disconnected, error).
 *  - Export connectMongo() and disconnectMongo() for use by the health-check and future services.
 *
 * Single Responsibility: This file ONLY manages the Mongoose connection lifecycle.
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

const MONGO_URI = process.env.MONGO_URI;

// ─── Connection Lifecycle Event Logging ───────────────────────────────────────

mongoose.connection.on('connected', () => {
    const host = mongoose.connection.host || 'unknown';
    logger.info(`Mongoose connected    | host: ${host}`);
});

mongoose.connection.on('disconnected', () => {
    logger.info(`Mongoose disconnected`);
});

mongoose.connection.on('error', (err) => {
    logger.error(`Mongoose error        | error: ${err.message}`);
});

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Establishes a Mongoose connection to MongoDB Atlas.
 *
 * Logs:
 *  - [CALL] on entry with URI masked (shows host only).
 *  - [DONE] on success with readyState=1.
 *  - [ERROR] on failure with error message.
 *
 * @returns {Promise<void>} Resolves when Mongoose reaches readyState=1.
 * @throws {Error} If connection fails.
 */
const connectMongo = async () => {
    if (!MONGO_URI || MONGO_URI.includes('<username>')) {
        const msg = 'MONGO_URI is not configured. Please update modules/database/.env with your Atlas connection string.';
        logger.error(msg);
        throw new Error(msg);
    }

    // Mask credentials for safe logging (show only the host part)
    const maskedUri = MONGO_URI.replace(/:\/\/[^@]+@/, '://<credentials>@');
    logger.call('connectMongo', `MONGO_URI: ${maskedUri}`);

    try {
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 5000, // Fail fast after 5s if unreachable
        });
        const readyState = mongoose.connection.readyState;
        logger.done('connectMongo', `readyState=${readyState}`);
    } catch (err) {
        logger.error(`connectMongo failed | error: ${err.message}`);
        throw err;
    }
};

/**
 * Gracefully closes the Mongoose connection.
 *
 * Logs:
 *  - [CALL] on entry.
 *  - [DONE] after disconnect.
 *
 * @returns {Promise<void>} Resolves after the connection is closed.
 */
const disconnectMongo = async () => {
    logger.call('disconnectMongo', 'none');
    try {
        await mongoose.disconnect();
        logger.done('disconnectMongo', 'Connection closed');
    } catch (err) {
        logger.error(`disconnectMongo failed | error: ${err.message}`);
        throw err;
    }
};

module.exports = {
    connectMongo,
    disconnectMongo,
};
