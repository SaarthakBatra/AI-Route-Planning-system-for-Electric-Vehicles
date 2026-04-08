/**
 * @file feature_regression.test.js
 * @module tests/backend/feature_regression
 * @description Verifies that v2.5.0 features do not break legacy expectations and handle edge cases gracefully.
 */
const request = require('supertest');
const app = require('../../modules/backend/index');
const { calculateRouteGrpc } = require('../../modules/backend/services/grpcClient');

jest.mock('../../modules/backend/services/grpcClient', () => ({
    calculateRouteGrpc: jest.fn()
}));
jest.mock('../../modules/cache/services/osmWorker', () => ({
    getMapPayload: jest.fn().mockResolvedValue({ binary: Buffer.from('mock'), region_id: 'bbox:1' })
}));

describe('v2.5.0 Feature Regression & Boundary Suite', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('1. Backward Compatibility: Legacy Non-EV Request', async () => {
        calculateRouteGrpc.mockResolvedValue({
            results: [{
                algorithm: 'Dijkstra',
                distance: 1000,
                duration: 60,
                polyline: [{ lat: 10, lng: 10 }, { lat: 11, lng: 11 }]
            }]
        });

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 10, lng: 10 },
                end: { lat: 11, lng: 11 }
            });

        expect(response.status).toBe(200);
        expect(response.body.data.results[0].polyline[0]).toHaveProperty('segment_consumed_kwh', 0);
    });

    test('2. Partial Data: Engine returns polyline without segment_consumed_kwh', async () => {
        calculateRouteGrpc.mockResolvedValue({
            results: [{
                algorithm: 'A*',
                polyline: [{ lat: 10, lng: 10 }] // Missing field
            }]
        });

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 0, lng: 0 },
                end: { lat: 1, lng: 1 },
                enabled: true
            });

        expect(response.status).toBe(200);
        expect(response.body.data.results[0].polyline[0].segment_consumed_kwh).toBe(0);
    });

    test('3. Boundary Values: Extreme target_charge_bound_kwh', async () => {
        calculateRouteGrpc.mockResolvedValue({ results: [] });

        // Boundary: 999 (Invalid/Too Large)
        const responseOverLimit = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 0, lng: 0 },
                end: { lat: 1, lng: 1 },
                enabled: true,
                target_charge_bound_kwh: 999.0 
            });
        expect(responseOverLimit.status).toBe(400);

        // Boundary: 600 (Beyond Joi Max 500)
        const responseOverJoi = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 0, lng: 0 },
                end: { lat: 1, lng: 1 },
                enabled: true,
                target_charge_bound_kwh: 600.0 
            });
        expect(responseOverJoi.status).toBe(400);

        // Boundary: 0.0 (Valid Zero-Bound)
        await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 0, lng: 0 },
                end: { lat: 1, lng: 1 },
                enabled: true,
                target_charge_bound_kwh: 0.0 
            });
        
        // Note: 400 errors above don't call the mock engine. This should be the first call.
        expect(calculateRouteGrpc.mock.calls[0][0].evParams.target_charge_bound_kwh).toBe(0);
    });

    test('4. Circuit Breaker Integrity with New Mapping', async () => {
        calculateRouteGrpc.mockResolvedValue({
            results: [{
                algorithm: 'IDA*',
                circuit_breaker_triggered: true,
                nodes_expanded: 10000000,
                polyline: [{ lat: 1, lng: 1, segment_consumed_kwh: 10 }] // Should be cleared
            }]
        });

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 0, lng: 0 },
                end: { lat: 1, lng: 1 }
            });

        const result = response.body.data.results[0];
        expect(result.circuit_breaker_triggered).toBe(true);
        expect(result.polyline).toHaveLength(0); // Standardized Failure Signature
    });
});
