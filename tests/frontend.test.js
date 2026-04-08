/**
 * @fileoverview Frontend Module Tests
 * Step 1 Tracer Bullet Tests for pure JS logic in app.js
 */

const assert = require('assert');
const path = require('path');

console.log("\n[test] Running Frontend Module Tests...");

// Load app.js by providing a mock DOM & Leaflet environment
// Load app.js by providing a mock DOM & Leaflet environment
const mockState = {
    'hour-slider': { value: '12' },
    'start-soc': { value: '80' },
    'battery-soh': { value: '100' },
    'payload-slider': { value: '0' },
    'drag-coeff': { value: '0.23' },
    'frontal-area': { value: '2.22' },
    'crr-coeff': { value: '0.012' },
    'wheel-radius': { value: '0.35' },
    'min-waypoint-soc': { value: '10' },
    'min-arrival-soc': { value: '20' },
    'regen-efficiency': { value: '75' },
    'aux-power': { value: '0.5' },
    'ambient-temp': { value: '25' },
    'eco-slider': { value: '50' },
    'target-charge': { value: '80' },
    'mission-charge-bound': { value: '50.5' },
    'emergency-mode': { checked: true },
    'calc-route-btn': { disabled: false },
    'reset-btn': {},
    'start-input': { value: '' },
    'end-input': { value: '' },
    'objective-select': { value: 'FASTEST' },
    'hour-display': {},
    'start-suggestions': { classList: { add: () => {} }, innerHTML: '' },
    'end-suggestions': { classList: { add: () => {} }, innerHTML: '' },
    'route-info': { classList: { add: () => {}, remove: () => {} } },
    'route-distance': { innerText: '' },
    'route-duration': { innerText: '' },
    'notifications-container': { innerHTML: '' },
    'ev-routing-toggle': { addEventListener: () => {} },
    'ev-params-panel': { classList: { toggle: () => {} } },
    'vehicle-preset': { addEventListener: () => {} },
    'payload-display': {},
    'eco-display': {},
    'log-soc-btn': { addEventListener: () => {} },
    'recompute-btn': { addEventListener: () => {}, classList: { add: () => {}, remove: () => {} } },
    'trip-execution-panel': { classList: { remove: () => {} } },
    'logger-inputs': { classList: { remove: () => {} } },
    'actual-soc-input': { value: '' },
    'deviation-value': { innerText: '' },
    'deviation-readout': { classList: { remove: () => {} } },
    'status-message': { className: '', innerText: '', classList: { add: () => {} } }
};

global.document = {
    getElementById: (id) => {
        const el = mockState[id] || {};
        return {
            addEventListener: () => {},
            classList: el.classList || { add: () => {}, remove: () => {}, toggle: () => {} },
            get innerText() { return el.innerText || ''; },
            get value() { return el.value || ''; },
            set value(v) { el.value = v; },
            get checked() { return el.checked || false; },
            set checked(v) { el.checked = v; },
            get disabled() { return el.disabled || false; },
            get innerHTML() { return el.innerHTML || ''; },
            style: {},
            querySelector: () => ({ addEventListener: () => {} })
        };
    },
    createElement: () => ({
        style: {},
        classList: { add: () => {} },
        addEventListener: () => {},
        querySelector: () => ({ addEventListener: () => {} }),
        innerHTML: ''
    }),
    addEventListener: () => {}
};

global.L = {
    map: () => ({ 
        setView: () => ({ 
            on: () => {} 
        }),
        removeLayer: () => {}
    }),
    tileLayer: () => ({ addTo: () => {} }),
    circleMarker: () => ({ addTo: () => {}, on: () => {}, bindTooltip: () => {} }),
    polyline: () => ({ addTo: () => {} }),
    control: {
        layers: () => ({ addTo: () => {} }),
        zoom: () => ({ addTo: () => {} })
    }
};

global.navigator = {
    geolocation: {
        getCurrentPosition: (success) => success({ coords: { latitude: 0, longitude: 0 } })
    }
};

global.window = {
    location: { hostname: 'localhost' }
};

const appJsPath = path.join(__dirname, '../modules/frontend/app.js');
try {
    const appCode = require(appJsPath);
    
    // --- Legacy Regression Tests ---
    
    // Test 1: Coordinate formatting logic
    assert.strictEqual(typeof appCode.formatCoord, 'function', "formatCoord should exist");
    const formatted = appCode.formatCoord({lat: 10.123, lng: 20.456, extra: 'noise'});
    assert.deepStrictEqual(formatted, {lat: 10.123, lng: 20.456}, "formatCoord stripped extra data");
    
    // Test 2: Distance formatting
    assert.strictEqual(typeof appCode.formatDistance, 'function', "formatDistance should exist");
    assert.strictEqual(appCode.formatDistance(500), "500 m", "formatDistance handles meters");
    assert.strictEqual(appCode.formatDistance(1500), "1.5 km", "formatDistance handles kilometers");

    // Test 3: Duration formatting
    assert.strictEqual(typeof appCode.formatDuration, 'function', "formatDuration should exist");
    assert.strictEqual(appCode.formatDuration(45), "45 secs", "formatDuration handles seconds");
    assert.strictEqual(appCode.formatDuration(120), "2 mins", "formatDuration handles minutes");
    assert.strictEqual(appCode.formatDuration(3660), "1 hr 1 min", "formatDuration handles hours");
    
    // --- v2.5.0 Synchronization Tests ---

    // Test 4: EV Payload Construction
    assert.strictEqual(typeof appCode.getEvPayload, 'function', "getEvPayload should exist");
    const evPayload = appCode.getEvPayload();
    
    assert.strictEqual(evPayload.enabled, true, "Payload should be enabled");
    assert.strictEqual(evPayload.target_charge_bound_kwh, 50.5, "target_charge_bound_kwh mapping correct");
    assert.strictEqual(evPayload.is_emergency_assumption, true, "is_emergency_assumption mapping correct");
    assert.strictEqual(evPayload.effective_mass_kg, 1800, "Base mass calculation correct (1800 + 0)");

    // Test 5: Zero-Value Safety for Charge Bound
    // Mock the mission-charge-bound as '0' via dynamic state
    mockState['mission-charge-bound'].value = '0';
    
    const zeroPayload = appCode.getEvPayload();
    assert.strictEqual(zeroPayload.target_charge_bound_kwh, undefined, "Explicit 0 should be undefined for fallback");
    assert.strictEqual(JSON.stringify(zeroPayload).includes('target_charge_bound_kwh'), false, "JSON.stringify should omit undefined keys");
    
    // Restore state
    mockState['mission-charge-bound'].value = '50.5';

    // Test 6: Polyline Segmentation Logic (v2.5.1 Flag-Based)
    assert.strictEqual(typeof appCode.splitPolylineIntoSegments, 'function', "splitPolylineIntoSegments should exist");
    
    const mockPolyline = [
        { lat: 10, lng: 20, is_regen: false, segment_consumed_kwh: 0.5, planned_soc_pct: 80 },
        { lat: 11, lng: 21, is_regen: false, segment_consumed_kwh: 0.5, planned_soc_pct: 79 },
        { lat: 12, lng: 22, is_regen: true,  segment_consumed_kwh: -0.2, planned_soc_pct: 79.2 }, // Transition to regen
        { lat: 13, lng: 23, is_regen: true,  segment_consumed_kwh: -0.1, planned_soc_pct: 79.3 }
    ];
    const mockLatLngs = [[10, 20], [11, 21], [12, 22], [13, 23]];
    
    const segments = appCode.splitPolylineIntoSegments(mockPolyline, mockLatLngs);
    assert.strictEqual(segments.length, 2, "Should split into exactly 2 segments");
    assert.strictEqual(segments[0].isRegen, false, "First segment is normal consumption");
    assert.strictEqual(segments[1].isRegen, true, "Second segment is regeneration");
    
    // Check seamless stitching (transition point present in both)
    assert.deepStrictEqual(segments[0].points[segments[0].points.length - 1], [12, 22], "First segment ends at transition point");
    assert.deepStrictEqual(segments[1].points[0], [12, 22], "Second segment starts at transition point");

    console.log("✅ All Frontend tests (Legacy + v2.5.0) passed.");
} catch (err) {
    console.error("❌ Frontend tests failed:", err.message);
    process.exit(1);
}
