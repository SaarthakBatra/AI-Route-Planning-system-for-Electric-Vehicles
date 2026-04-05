/**
 * @file logger.js
 * @module backend/utils/logger
 * @description High-performance logging utility with request-based buffering and disk-synchronization.
 * Supports cross-module log consolidation (Backend, Cache, Database) for a unified tracing experience.
 * 
 * @workflow
 * 1. Initialize output directory and maintain module-level buffering.
 * 2. Utilize AsyncLocalStorage (context.js) to isolate logs per request.
 * 3. Support "Log Flushes" on request completion or process signals (SIGINT/SIGTERM).
 * 4. Export a common logger interface (info, error, warn, debug).
 */
const fs = require('fs');
const path = require('path');
const { storage } = require('./context');

const OUTPUT_DIR = path.join(__dirname, '..', '..', '..', 'Output', 'Backend');

/**
 * Ensures the output directory exists.
 */
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Pushes log entries to the in-memory buffer for the current request.
 * @param {string} level - Log level (INFO, ERROR, etc)
 * @param {string} msg - The message
 * @param {any} data - Optional data to log
 */
const bufferLog = (level, msg, data = null) => {
    const store = storage.getStore();
    if (!store || !store.backendBuffer) return;

    const isoTime = new Date().toISOString();
    let entry = `| ${isoTime} | ${level} | ${msg} |`;
    if (data) {
        entry += `\n\n**Data:**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
    }
    store.backendBuffer.push(entry);
};

/**
 * Flushes a specific module's buffer to its designated directory.
 */
const flushModuleBuffer = (logDir, moduleName, logTimestamp, buffer, isEmergency = false) => {
    if (!buffer || buffer.length === 0) return;

    const dir = path.join(__dirname, '..', '..', '..', 'Output', logDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${moduleName}.md`);
    
    let content = '';
    // Append header if the file doesn't exist yet
    if (!fs.existsSync(filePath)) {
        content += `# ${moduleName.toUpperCase()} SESSION START: ${new Date(logTimestamp).toUTCString()}\n**Session ID:** ${logTimestamp}\n\n| Timestamp | Level | Message |\n|-----------|-------|---------|\n`;
    }
    
    content += buffer.join('\n') + '\n';
    
    if (!isEmergency) {
        content += `\n# ${moduleName.toUpperCase()} SESSION END: ${new Date().toUTCString()}\n`;
    } else {
        content += `\n# ${moduleName.toUpperCase()} SESSION ABORTED / EMERGENCY FLUSH: ${new Date().toUTCString()}\n`;
    }

    fs.appendFileSync(filePath, content);
    buffer.length = 0; // Clear the buffer after flushing
};

/**
 * Flushes all logs in the current session's buffers to disk via normal completion.
 */
const flushAllLogs = () => {
    const store = storage.getStore();
    if (!store || !store.logDir) return;

    const { logTimestamp, logDir, backendBuffer, cacheBuffer, databaseBuffer } = store;

    flushModuleBuffer(logDir, 'Backend', logTimestamp, backendBuffer, false);
    flushModuleBuffer(logDir, 'Cache', logTimestamp, cacheBuffer, false);
    flushModuleBuffer(logDir, 'Database', logTimestamp, databaseBuffer, false);
};

const { activeRegistry } = require('./context');

/**
 * Flushes all currently active requests globally (Emergency / Watchdog).
 */
const flushAllActiveRequests = (isExit = false) => {
    for (const store of activeRegistry) {
        if (!store || !store.logDir) continue;
        const { logTimestamp, logDir, backendBuffer, cacheBuffer, databaseBuffer } = store;
        
        flushModuleBuffer(logDir, 'Backend', logTimestamp, backendBuffer, true);
        flushModuleBuffer(logDir, 'Cache', logTimestamp, cacheBuffer, true);
        flushModuleBuffer(logDir, 'Database', logTimestamp, databaseBuffer, true);
    }
    if (isExit) console.log(`[LOGGER] Flushed ${activeRegistry.size} active requests.`);
};

// --- Watchdog & Emergency Handlers ---
const flushInterval = parseInt(process.env.LOG_FLUSH_INTERVAL) || 0;
if (flushInterval > 0) {
    setInterval(() => {
        flushAllActiveRequests(false);
    }, flushInterval * 1000);
}

process.on('SIGINT', () => {
    console.log('\n[EMERGENCY] SIGINT received. Flushing all active Node.js logs...');
    flushAllActiveRequests(true);
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[EMERGENCY] SIGTERM received. Flushing all active Node.js logs...');
    flushAllActiveRequests(true);
    process.exit(0);
});

process.on('SIGUSR1', () => {
    console.log('\n[EMERGENCY] SIGUSR1 received. Flushing active logs but continuing execution...');
    flushAllActiveRequests(false);
});

/**
 * Development-friendly logger with buffered Markdown synchronization.
 */
const logger = {
    info: (msg) => {
        console.log(`[INFO] ${msg}`);
        bufferLog('INFO', msg);
    },
    error: (msg) => {
        console.error(`[ERROR] ${msg}`);
        bufferLog('ERROR', msg);
    },
    warn: (msg) => {
        console.warn(`[WARN] ${msg}`);
        bufferLog('WARN', msg);
    },
    debug: (msg, data = null) => {
        if (process.env.DEBUG === 'true') {
            console.debug(`[DEBUG] ${msg}`);
            if (data) {
                console.debug(JSON.stringify(data, null, 2));
            }
        }
        bufferLog('DEBUG', msg, data);
    },
    flushAllLogs
};

module.exports = logger;
