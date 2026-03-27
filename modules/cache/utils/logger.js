require('dotenv').config({ path: __dirname + '/.env' });

/**
 * @fileoverview Centralized logger for the Cache module.
 * Prefixes all messages with [CACHE] and supports CALL/DONE tracing.
 * Controlled by the DEBUG environment variable.
 */

const PREFIX = '[CACHE]';

/**
 * Core logger object with info, error, warn, and debug levels.
 * Every exported function from this module uses these methods.
 */
const logger = {
    /**
     * Logs an informational message.
     * @param {string} msg - The message to log.
     */
    info: (msg) => console.log(`${PREFIX} [INFO]  ${msg}`),

    /**
     * Logs an error message.
     * @param {string} msg - The error message.
     */
    error: (msg) => console.error(`${PREFIX} [ERROR] ${msg}`),

    /**
     * Logs a warning message.
     * @param {string} msg - The warning message.
     */
    warn: (msg) => console.warn(`${PREFIX} [WARN]  ${msg}`),

    /**
     * Logs a debug message — only active when DEBUG=true.
     * @param {string} msg - The debug message.
     * @param {*} [data] - Optional data object to pretty-print.
     */
    debug: (msg, data = null) => {
        if (process.env.DEBUG === 'true') {
            console.debug(`${PREFIX} [DEBUG] ${msg}`);
            if (data !== null && data !== undefined) {
                console.debug(JSON.stringify(data, null, 2));
            }
        }
    },

    /**
     * Logs a CALL event when a function is entered.
     * @param {string} fnName - The name of the function being entered.
     * @param {string} [input='none'] - A string representation of the input.
     */
    call: (fnName, input = 'none') => {
        console.log(`${PREFIX} [CALL] ${fnName} | input: ${input}`);
    },

    /**
     * Logs a DONE event when a function exits successfully.
     * @param {string} fnName - The name of the function that completed.
     * @param {string} [output='void'] - A string representation of the output.
     */
    done: (fnName, output = 'void') => {
        console.log(`${PREFIX} [DONE] ${fnName} | output: ${output}`);
    }
};

module.exports = logger;
