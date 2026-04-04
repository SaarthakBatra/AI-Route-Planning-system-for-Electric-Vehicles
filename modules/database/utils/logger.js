/**
 * @fileoverview Central logging utility for the Database module.
 * 
 * DESIGN PRINCIPLES:
 * 1. Synchronized Tracing: Integrates with AsyncLocalStorage to buffer logs per-request.
 * 2. Visual Clarity: Uses [DATABASE] prefix and semantic tags ([CALL], [DONE], [INFO]).
 * 3. Atomic Buffering: Prevents I/O blocking by pushing to in-memory buffers before eventual flush.
 *
 * WORKFLOW:
 * - Each log call (info, error, call, etc.) outputs to the standard console.
 * - Additionally, it attempts to retrieve the current request context (storage).
 * - If a context exists, it formats the message as Markdown and appends it to the databaseBuffer.
 */

const { storage } = require('../../backend/utils/context');

const PREFIX = '[DATABASE]';

/**
 * Pushes formatted log entries to the in-memory buffer of the current request context.
 * Useful for building a comprehensive execution trace for the frontend/debugging.
 *
 * @param {string} level - The log level (e.g., 'INFO', 'ERROR', 'CALL', 'DONE', 'DEBUG').
 * @param {string} msg - The core log message.
 * @param {Object|Array|null} [data=null] - Optional structured data to be stringified as JSON.
 * @returns {void}
 */
const bufferLog = (level, msg, data = null) => {
    const store = storage.getStore();
    // Only buffer if a context is active and has a databaseBuffer initialized.
    if (!store || !store.databaseBuffer) return;

    const isoTime = new Date().toISOString();
    let entry = `| ${isoTime} | ${level} | ${msg} |`;
    
    // Supplement with JSON-formatted data blocks if provided
    if (data !== null && data !== undefined) {
        entry += `\n\n**Data:**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
    }
    store.databaseBuffer.push(entry);
};

/**
 * Core logger object providing standardized log levels and formatted output.
 * Each method handles console output and synchronization with the request context.
 */
const logger = {
    /**
     * Standard informational logging.
     * @param {string} msg - Message to log.
     */
    info: (msg) => {
        console.log(`${PREFIX} [INFO]  ${msg}`);
        bufferLog('INFO', msg);
    },

    /**
     * Error logging to stderr.
     * @param {string} msg - Error message.
     */
    error: (msg) => {
        console.error(`${PREFIX} [ERROR] ${msg}`);
        bufferLog('ERROR', msg);
    },

    /**
     * Warning logging to stdout.
     * @param {string} msg - Warning message.
     */
    warn: (msg) => {
        console.warn(`${PREFIX} [WARN]  ${msg}`);
        bufferLog('WARN', msg);
    },

    /**
     * Debug-level logging, active only if environment variable DEBUG=true.
     * @param {string} msg - Debug message.
     * @param {any} [data=null] - Optional supplementary data for the log.
     */
    debug: (msg, data = null) => {
        if (process.env.DEBUG === 'true') {
            console.debug(`${PREFIX} [DEBUG] ${msg}`);
            if (data !== null && data !== undefined) {
                console.debug(JSON.stringify(data, null, 2));
            }
        }
        bufferLog('DEBUG', msg, data);
    },

    /**
     * Trace-level logging for function entry points.
     * @param {string} fnName - Name of the function being called.
     * @param {string} [input='none'] - Stringified input parameters for tracing.
     */
    call: (fnName, input = 'none') => {
        const msg = `[CALL] ${fnName} | input: ${input}`;
        console.log(`${PREFIX} ${msg}`);
        bufferLog('CALL', msg);
    },

    /**
     * Trace-level logging for function completion.
     * @param {string} fnName - Name of the function that finished.
     * @param {string} [output='void'] - Stringified output/result for tracing.
     */
    done: (fnName, output = 'void') => {
        const msg = `[DONE] ${fnName} | output: ${output}`;
        console.log(`${PREFIX} ${msg}`);
        bufferLog('DONE', msg);
    }
};

module.exports = logger;

