/**
 * @file requestLogger.js
 * @module backend/utils/requestLogger
 * @description Express middleware for automatic inbound request and outbound response logging.
 */
const logger = require('./logger');

/**
 * Express middleware to log full request and response lifecycles.
 * Intercepts `res.json` and `res.send` to capture outbound payloads.
 */
const requestLogger = (req, res, next) => {
    // Only process detailed logging if DEBUG is true
    if (process.env.DEBUG !== 'true') {
        return next();
    }

    const { method, originalUrl, query, body } = req;
    const startTime = Date.now();

    logger.debug('--- INCOMING REQUEST ---');
    logger.debug(`${method} ${originalUrl}`);
    if (Object.keys(query).length) logger.debug('Query:', query);
    if (Object.keys(body).length) logger.debug('Body:', body);

    // Intercept res.json
    const originalJson = res.json;
    res.json = function (obj) {
        const duration = Date.now() - startTime;
        logger.debug(`--- OUTGOING JSON RESPONSE (${duration}ms) ---`);
        logger.debug(`Status: ${res.statusCode}`);
        logger.debug('Payload:', obj);
        return originalJson.call(this, obj);
    };

    // Intercept res.send
    const originalSend = res.send;
    res.send = function (content) {
        // If it was already hijacked by res.json, don't double log.
        // Express converts JSON objects to Strings under the hood before res.send.
        if (typeof content === 'string' && !res.get('Content-Type')?.includes('application/json')) {
            const duration = Date.now() - startTime;
            logger.debug(`--- OUTGOING RESPONSE (${duration}ms) ---`);
            logger.debug(`Status: ${res.statusCode}`);
            logger.debug('Payload:', content);
        }
        return originalSend.call(this, content);
    };

    next();
};

module.exports = requestLogger;
