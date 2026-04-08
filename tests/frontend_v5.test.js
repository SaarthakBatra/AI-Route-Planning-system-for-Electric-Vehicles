/**
 * @fileoverview Frontend Module Tests - Stage 5 High-Fidelity EV Logic
 * Validates physics-based conversions, preset application, and RCSPP payload integrity.
 */

const assert = require('assert');
const path = require('path');

console.log("\n[test] Running Frontend Stage 5 (EV Mission Control) Tests...");

// Specialized Mock for EV UI
let mockValues = {
    'battery-soh': '100',
    'start-soc': '80',
    'payload-slider': '0',
    'ambient-temp': '25',
    'target-charge': '80',
    'eco-slider': '50',
    'drag-coeff': '0.23',
    'frontal-area': '2.22',
    'crr-coeff': '0.012',
    'wheel-radius': '0.35',
    'min-waypoint-soc': '10',
    'min-arrival-soc': '20',
    'regen-efficiency': '75',
    'aux-power': '0.5'
};

global.document = {
    getElementById: (id) => ({
        addEventListener: () => {},
        classList: { add: () => {}, remove: () => {}, toggle: () => {} },
        innerText: '',
        value: mockValues[id] || '',
        disabled: false
    }),
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
    map: () => ({ setView: () => ({ on: () => {} }), removeLayer: () => {} }),
    tileLayer: () => ({ addTo: () => {} }),
    circleMarker: () => ({ addTo: () => {}, on: () => {}, bindTooltip: () => {} }),
    polyline: () => ({ addTo: () => {} })
};

const appJsPath = path.join(__dirname, '../modules/frontend/app.js');

try {
    const appCode = require(appJsPath);

    // Test 1: Preset Application
    console.log("Testing applyVehiclePreset('tesla_y')...");
    appCode.applyVehiclePreset('tesla_y');
    // Verify that the helper updated the UI inputs (mock state doesn't update automatically, 
    // but the function should have called .value = ...)
    // In our manual test we check if the code runs without crashing.
    
    // Test 2: Unit Conversion Logic (SoC % to kWh)
    console.log("Testing getEvPayload conversion logic...");
    // Mock 60kWh battery at 100% SOH and 50% Start SoC
    mockValues['battery-soh'] = '100';
    mockValues['start-soc'] = '50';
    
    const payload = appCode.getEvPayload();
    
    // Start SoC should be 60 * 1.0 * 0.5 = 30 kWh
    assert.strictEqual(payload.start_soc_kwh, 30, "50% SoC on 60kWh battery should be 30kWh");
    
    // Test 3: SOH Impact
    console.log("Testing SoH impact on effective capacity...");
    mockValues['battery-soh'] = '90'; // 10% degradation
    mockValues['start-soc'] = '100'; // Full charge
    
    const payloadSoh = appCode.getEvPayload();
    // 60 * 0.9 * 1.0 = 54 kWh
    assert.strictEqual(payloadSoh.start_soc_kwh, 54, "100% SoC on 90% SoH 60kWh battery should be 54kWh");

    // Test 4: Payload Weight Math
    console.log("Testing effective mass calculation...");
    mockValues['payload-slider'] = '500';
    const payloadMass = appCode.getEvPayload();
    // Base mass for Tesla 3 (default) is 1750? No, Tesla 3 is 1750, but Y was applied.
    // Wait, applyVehiclePreset('tesla_y') set the state.evParams.vehicle_mass_kg to 1950.
    // 1950 + 500 = 2450
    assert.strictEqual(payloadMass.effective_mass_kg, 2450, "1950kg car + 500kg payload should be 2450kg");

    // Test 5: Regen Efficiency Conversion
    console.log("Testing regen efficiency (%% to unitless)...");
    mockValues['regen-efficiency'] = '85';
    const payloadRegen = appCode.getEvPayload();
    assert.strictEqual(payloadRegen.regen_efficiency, 0.85, "85% regen should be 0.85 unitless");

    console.log("✅ Frontend Stage 5 Logic Tests passed.");
} catch (err) {
    console.error("❌ Frontend Stage 5 Tests failed:", err.message);
    console.error(err.stack);
    process.exit(1);
}
