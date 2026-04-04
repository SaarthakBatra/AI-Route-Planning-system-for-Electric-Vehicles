/**
 * @fileoverview Request-context-aware logger for the Cache module.
 *
 * Features:
 *  - Categorized logging (INFO, WARN, ERROR, CALL, DONE).
 *  - Automatic request-buffer synchronization for log flushing.
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
    info: (msg) => {
        console.log(`${PREFIX} [INFO]  ${msg}`);
        bufferLog('INFO', msg);
    },
    error: (msg) => {
        console.error(`${PREFIX} [ERROR] ${msg}`);
        bufferLog('ERROR', msg);
    },
    warn: (msg) => {
        console.warn(`${PREFIX} [WARN]  ${msg}`);
        bufferLog('WARN', msg);
    },
    debug: (msg, data = null) => {
        if (process.env.DEBUG === 'true') {
            console.debug(`${PREFIX} [DEBUG] ${msg}`);
            if (data !== null && data !== undefined) {
                console.debug(JSON.stringify(data, null, 2));
            }
        }
        bufferLog('DEBUG', msg, data);
    },
    call: (fnName, input = 'none') => {
        const msg = `[CALL] ${fnName} | input: ${input}`;
        console.log(`${PREFIX} ${msg}`);
        bufferLog('CALL', msg);
    },
    done: (fnName, output = 'void') => {
        const msg = `[DONE] ${fnName} | output: ${output}`;
        console.log(`${PREFIX} ${msg}`);
        bufferLog('DONE', msg);
    }
};

module.exports = logger;
