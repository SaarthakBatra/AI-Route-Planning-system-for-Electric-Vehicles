const path = require('path');
const osmWorker = require(path.resolve(__dirname, '../modules/cache/services/osmWorker'));
const logger = require(path.resolve(__dirname, '../modules/cache/utils/logger'));

// Mock global fetch
const originalFetch = global.fetch;

async function runTest() {
    const bbox = { minLat: 40.7128, minLon: -74.0060, maxLat: 40.7138, maxLon: -74.0050 };

    console.log('\n--- Test 1: Retry on 504 (Exponential Backoff) ---');
    let calls = 0;
    const startTime = Date.now();
    
    global.fetch = async () => {
        calls++;
        if (calls < 3) {
            console.log(`[Mock] Returning 504 (Call ${calls}) at ${Date.now() - startTime}ms`);
            return { ok: false, status: 504, statusText: 'Gateway Timeout' };
        }
        console.log(`[Mock] Returning 200 (Call ${calls}) at ${Date.now() - startTime}ms`);
        return {
            ok: true,
            status: 200,
            json: async () => ({ elements: [{ type: 'node', id: 1, lat: 40.7128, lon: -74.0060 }] })
        };
    };

    try {
        const data = await osmWorker.getMapData(bbox);
        console.log(`Result: Success after ${calls} calls. Total time: ${Date.now() - startTime}ms`);
        console.log('Note: Initial backoff should be ~2s, then ~4s.');
    } catch (err) {
        console.error('Test 1 Failed:', err.message);
    }

    console.log('\n--- Test 2: Client-side Timeout (AbortController) ---');
    process.env.OSM_TIMEOUT_MS = '1000';
    process.env.OSM_REQ_RETRY_COUNT = '1';
    
    let timeoutCalls = 0;
    global.fetch = async (url, options) => {
        timeoutCalls++;
        console.log(`[Mock] Slow response start (Call ${timeoutCalls})`);
        return new Promise((_, reject) => {
            options.signal.addEventListener('abort', () => {
                console.log(`[Mock] Signal Aborted (Call ${timeoutCalls})`);
                const err = new Error('The operation was aborted');
                err.name = 'AbortError';
                reject(err);
            });
        });
    };

    try {
        await osmWorker.getMapData({ ...bbox, minLat: 40.0 }); // Different bbox to avoid cache
    } catch (err) {
        console.log('Caught Expected Error:', err.message);
        console.log('Status code in error:', err.status);
    }

    // Restore
    global.fetch = originalFetch;
    process.exit(0);
}

runTest();
