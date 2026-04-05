/**
 * @file requestLogger.js
 * @module backend/utils/requestLogger
 * @description Express middleware for automatic inbound request and outbound response logging.
 * Intercepts res.json/res.send to provide high-fidelity traces in the request context.
 * 
 * @workflow
 * 1. Extract request metadata (method, URL, body).
 * 2. Log "INCOMING REQUEST" if DEBUG=true.
 * 3. Wrap res.json and res.send to capture outbound status and payload.
 * 4. Summarize large route payloads to keep log files readable.
 * 5. Calculate and log request duration.
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

        // Optimize trace log performance by summarizing large route payloads
        if (obj && obj.success && obj.data && Array.isArray(obj.data.results)) {
            const summary = obj.data.results.map(r => ({
                algorithm: r.algorithm,
                distance: r.distance,
                nodes_expanded: r.nodes_expanded,
                nodes_in_path: r.polyline ? r.polyline.length : 0
            }));
            logger.debug('Payload (Summary):', summary);
        } else {
            logger.debug('Payload:', obj);
        }

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
