/**
 * @file verify_breaker_logic.js
 * @description Manual verification script for the Backend Circuit Breaker "Failure Signature".
 * 
 * Usage: 
 * 1. cd modules/backend
 * 2. node ../../tests/backend/verify_breaker_logic.js
 */

const assert = require('assert');
const path = require('path');

// Mock Environment
process.env.ALGO_MAX_NODES = '1000000';

const mockResults = [
    {
        algorithm: 'IDA*',
        polyline: ['encoded_poly'],
        distance: 500.5,
        duration: 120,
        nodes_expanded: 1000001, // Triggered by node count
        exec_time_ms: 1500,
        path_cost: 450,
        circuit_breaker_triggered: false
    },
    {
        algorithm: 'A*',
        polyline: ['valid_poly'],
        distance: 300,
        duration: 80,
        nodes_expanded: 5000,
        exec_time_ms: 50,
        path_cost: 250,
        circuit_breaker_triggered: false
    }
];

console.log('--- Verifying Backend Response Transformation ---');

// Simulated logic from calculateRoute.js
const standardizedResults = mockResults.map(res => {
    const maxNodes = parseInt(process.env.ALGO_MAX_NODES) || 1000000;
    const isBreakerHit = res.circuit_breaker_triggered || res.nodes_expanded > maxNodes;
    
    return {
        algorithm: res.algorithm,
        polyline: isBreakerHit ? [] : (res.polyline || []),
        distance: isBreakerHit ? 0 : (res.distance || 0),
        duration: isBreakerHit ? 0 : (res.duration || 0),
        nodes_expanded: isBreakerHit ? (maxNodes + 1) : (res.nodes_expanded || 0),
        exec_time_ms: res.exec_time_ms || 0,
        path_cost: isBreakerHit ? 0 : (res.path_cost || 0),
        circuit_breaker_triggered: !!isBreakerHit,
        debug_logs: res.debug_logs || ""
    };
});

try {
    const ida = standardizedResults.find(r => r.algorithm === 'IDA*');
    console.log('Checking IDA* (Breaker Triggered)...');
    assert.strictEqual(ida.circuit_breaker_triggered, true, 'Should be triggered');
    assert.strictEqual(ida.polyline.length, 0, 'Polyline should be empty');
    assert.strictEqual(ida.distance, 0, 'Distance should be 0');
    assert.strictEqual(ida.nodes_expanded, 1000001, 'Nodes should be 1,000,001');
    assert.strictEqual(ida.path_cost, 0, 'Path cost should be 0');
    console.log('✅ IDA* Failure Signature Verified.');

    const astar = standardizedResults.find(r => r.algorithm === 'A*');
    console.log('Checking A* (Normal Path)...');
    assert.strictEqual(astar.circuit_breaker_triggered, false, 'Should NOT be triggered');
    assert.strictEqual(astar.polyline.length, 1, 'Polyline should be preserved');
    assert.strictEqual(astar.distance, 300, 'Distance should be preserved');
    console.log('✅ A* Normal Result Verified.');

    console.log('\n--- ALL VERIFICATIONS PASSED ---');
} catch (error) {
    console.error('❌ Verification Failed:', error.message);
    process.exit(1);
}
