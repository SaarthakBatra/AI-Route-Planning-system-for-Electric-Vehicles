/**
 * @fileoverview Request-Context-Aware Logger for the Cache module.
 *
 * Workflow:
 *  1. Context Retrieval: Uses `AsyncLocalStorage` from the backend to isolate logs per request.
 *  2. Multi-Channel Output:
 *      a. Console: Real-time stdout/stderr for immediate debugging.
 *      b. Markdown Buffer: Pushes formatted log strings to `store.cacheBuffer` for final 
 *         web UI / artifact generation (traceability).
 *  3. Verbose Safety: `debug()` only outputs to the console if `process.env.DEBUG` is 'true'.
 */

const { storage } = require('../../backend/utils/context');

const PREFIX = '[CACHE]';

/**
 * Pushes log entries to the in-memory buffer for the current request.
 * @param {string} level - Log level (INFO, ERROR, etc)
 * @param {string} msg - The message
 * @param {any} data - Optional data to log
 */
const bufferLog = (level, msg, data = null) => {
    const store = storage.getStore();
    if (!store || !store.cacheBuffer) return;

    const isoTime = new Date().toISOString();
    let entry = `| ${isoTime} | ${level} | ${msg} |`;
    if (data) {
        entry += `\n\n**Data:**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
    }
    store.cacheBuffer.push(entry);
};

/**
 * Core logger object with buffered Markdown synchronization.
 */
const logger = {
    /**
     * Logs informational messages.
     * @param {string} msg 
     */
    info: (msg) => {
        console.log(`${PREFIX} [INFO]  ${msg}`);
        bufferLog('INFO', msg);
    },
    /**
     * Logs error messages.
     * @param {string} msg 
     */
    error: (msg) => {
        console.error(`${PREFIX} [ERROR] ${msg}`);
        bufferLog('ERROR', msg);
    },
    /**
     * Logs warning messages.
     * @param {string} msg 
     */
    warn: (msg) => {
        console.warn(`${PREFIX} [WARN]  ${msg}`);
        bufferLog('WARN', msg);
    },
    /**
     * Logs debug messages, optionally with data.
     * Only outputs to console if process.env.DEBUG is 'true'.
     * @param {string} msg 
     * @param {any} [data] 
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
     * Logs the entry of a function call.
     * @param {string} fnName 
     * @param {string} [input='none'] 
     */
    call: (fnName, input = 'none') => {
        const msg = `[CALL] ${fnName} | input: ${input}`;
        console.log(`${PREFIX} ${msg}`);
        bufferLog('CALL', msg);
    },
    /**
     * Logs the successful completion of a function.
     * @param {string} fnName 
     * @param {string} [output='void'] 
     */
    done: (fnName, output = 'void') => {
        const msg = `[DONE] ${fnName} | output: ${output}`;
        console.log(`${PREFIX} ${msg}`);
        bufferLog('DONE', msg);
    }
};

module.exports = logger;
