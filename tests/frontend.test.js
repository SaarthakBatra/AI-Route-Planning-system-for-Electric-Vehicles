/**
 * @fileoverview Frontend Module Tests
 * Step 1 Tracer Bullet Tests for pure JS logic in app.js
 */

const assert = require('assert');
const path = require('path');

console.log("\n[test] Running Frontend Module Tests...");

// Load app.js by providing a mock DOM & Leaflet environment
global.document = {
    getElementById: () => ({
        addEventListener: () => {},
        classList: { add: () => {}, remove: () => {} },
        innerText: ''
    }),
    addEventListener: () => {}
};

global.L = {
    map: () => ({ setView: () => ({ on: () => {} }) }),
    tileLayer: () => ({ addTo: () => {} })
};

const appJsPath = path.join(__dirname, '../modules/frontend/app.js');
try {
    const appCode = require(appJsPath);
    
    // Test 1: Coordinate formatting logic
    assert.strictEqual(typeof appCode.formatCoord, 'function', "formatCoord should exist");
    const formatted = appCode.formatCoord({lat: 10.123, lng: 20.456, extra: 'noise'});
    assert.deepStrictEqual(formatted, {lat: 10.123, lng: 20.456}, "formatCoord stripped extra data");
    
    // Test 3: Distance formatting
    assert.strictEqual(typeof appCode.formatDistance, 'function', "formatDistance should exist");
    assert.strictEqual(appCode.formatDistance(500), "500 m", "formatDistance handles meters");
    assert.strictEqual(appCode.formatDistance(1500), "1.5 km", "formatDistance handles kilometers");

    // Test 4: Duration formatting
    assert.strictEqual(typeof appCode.formatDuration, 'function', "formatDuration should exist");
    assert.strictEqual(appCode.formatDuration(45), "45 secs", "formatDuration handles seconds");
    assert.strictEqual(appCode.formatDuration(120), "2 mins", "formatDuration handles minutes");
    assert.strictEqual(appCode.formatDuration(3660), "1 hr 1 min", "formatDuration handles hours");
    
    console.log("✅ Frontend Utilities passed.");
} catch (err) {
    console.error("❌ Frontend tests failed:", err.message);
    process.exit(1);
}
