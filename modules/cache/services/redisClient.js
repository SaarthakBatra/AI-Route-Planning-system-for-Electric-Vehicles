require('dotenv').config({ path: __dirname + '/../.env' });

/**
 * @fileoverview Redis client service for the Cache module.
 *
 * Responsibilities:
 *  - Create and configure a single shared ioredis client instance.
 *  - Log all connection lifecycle events (connect, ready, error, reconnecting).
 *  - Export pingRedis() for health validation.
 *
 * Single Responsibility: This file ONLY manages the Redis connection.
 */

const Redis = require('ioredis');
const logger = require('../utils/logger');

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT, 10) || 6379;
const TARGET = `${REDIS_HOST}:${REDIS_PORT}`;

logger.info(`Initializing Redis client | host: ${TARGET}`);

/**
 * Shared ioredis client instance.
 * @type {import('ioredis').Redis}
 */
const client = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    maxRetriesPerRequest: 3
});


// ─── Connection Lifecycle Event Logging ───────────────────────────────────────

client.on('connect', () => {
    logger.info(`Redis client connected     | host: ${TARGET}`);
});

client.on('ready', () => {
    logger.info(`Redis client ready         | host: ${TARGET}`);
});

client.on('error', (err) => {
    logger.error(`Redis client error         | error: ${err.message}`);
});

client.on('reconnecting', (delay) => {
    logger.warn(`Redis client reconnecting  | delay: ${delay}ms`);
});

client.on('close', () => {
    logger.info('Redis client connection closed');
});

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Sends a PING command to the Redis server to validate connectivity.
 *
 * Logs:
 *  - [CALL] on entry with input description.
 *  - [DONE] on success with the "PONG" response.
 *  - [ERROR] on failure with the error message.
 *
 * @returns {Promise<string>} Resolves with "PONG" on success.
 * @throws {Error} If the Redis connection fails.
 */
const pingRedis = async () => {
    logger.call('pingRedis', 'none');
    try {
        const response = await client.ping();
        logger.info(`Redis PING response: ${response}`);
        logger.done('pingRedis', response);
        return response;
    } catch (err) {
        logger.error(`pingRedis failed | error: ${err.message}`);
        throw err;
    }
};

module.exports = {
    client,
    pingRedis,
};
