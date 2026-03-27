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
        classList: { add: () => {}, remove: () => {} }
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
    
    // Test 2: Point string formatting logic
    assert.strictEqual(typeof appCode.displayCoord, 'function', "displayCoord should exist");
    const display = appCode.displayCoord({lat: 12.345678, lng: -98.765432});
    assert.strictEqual(display, "12.34568, -98.76543", "displayCoord formats precision correctly");
    
    console.log("✅ Frontend Utilities passed.");
} catch (err) {
    console.error("❌ Frontend tests failed:", err.message);
    process.exit(1);
}
