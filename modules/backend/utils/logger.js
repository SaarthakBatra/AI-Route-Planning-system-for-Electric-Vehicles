/**
 * Development-friendly logger (Pre-winston implementation)
 */
const logger = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    debug: (msg, data = null) => {
        if (process.env.DEBUG === 'true') {
            console.debug(`[DEBUG] ${msg}`);
            if (data) {
                console.debug(JSON.stringify(data, null, 2));
            }
        }
    }
};

module.exports = logger;
