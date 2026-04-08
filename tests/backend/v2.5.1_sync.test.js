/**
 * @file v2.5.1_sync.test.js
 * @description Deep-dive verification of Routing Engine v2.5.1 synchronization features,
 * with focus on coordinate-level metadata, regen flags, and battery-aware percentages.
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

describe('v2.5.1 EV Data Synchronization', () => {
    
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should handle zero-capacity edge case without crashing (fallback to 0%)', async () => {
        calculateRouteGrpc.mockResolvedValue({
            results: [{
                algorithm: 'Dijkstra',
                polyline: [{ lat: 0, lng: 0, planned_soc_kwh: 10.0 }],
                nodes_expanded: 10
            }]
        });

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 0, lng: 0 },
                end: { lat: 1, lng: 1 },
                vehicle_id: 'tesla_model_3',
                battery_soh_pct: 0 // Effective capacity = 0
            });

        expect(response.status).toBe(200);
        expect(response.body.data.results[0].polyline[0].planned_soc_pct).toBe(0);
    });

    it('should propagate is_regen flag specifically for dashed-polyline rendering', async () => {
        calculateRouteGrpc.mockResolvedValue({
            results: [{
                algorithm: 'A*',
                polyline: [
                    { lat: 0, lng: 0, segment_consumed_kwh: 0.1, is_regen: false },
                    { lat: 1, lng: 1, segment_consumed_kwh: -0.05, is_regen: true }
                ],
                nodes_expanded: 50
            }]
        });

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 0, lng: 0 },
                end: { lat: 1, lng: 1 },
                enabled: true
            });

        const polyline = response.body.data.results[0].polyline;
        expect(polyline[0].is_regen).toBe(false);
        expect(polyline[1].is_regen).toBe(true);
    });

    it('should correctly map charger status and metadata for path highlighting', async () => {
        calculateRouteGrpc.mockResolvedValue({
            results: [{
                algorithm: 'A*',
                polyline: [{
                    lat: 40.0, lng: 70.0,
                    is_charging_stop: true,
                    charger_type: 'CCS2',
                    kw_output: 150.0,
                    is_operational: true,
                    planned_soc_kwh: 60.0
                }],
                nodes_expanded: 20
            }]
        });

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 0, lng: 0 },
                end: { lat: 1, lng: 1 },
                vehicle_id: 'tesla_model_3' // 75kWh
            });

        const p0 = response.body.data.results[0].polyline[0];
        expect(p0.is_charging_stop).toBe(true);
        expect(p0.charger_type).toBe('CCS2');
        expect(p0.kw_output).toBe(150.0);
        expect(p0.is_operational).toBe(true);
        expect(p0.planned_soc_pct).toBe(60 / 75 * 100);
    });

    it('should ensure backward compatibility when coordinates lack v2.5.1 fields', async () => {
        // Simulating a legacy coordinate object from an older engine version
        calculateRouteGrpc.mockResolvedValue({
            results: [{
                algorithm: 'BFS',
                polyline: [{ lat: 51.5, lng: -0.1 }],
                nodes_expanded: 5
            }]
        });

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 0, lng: 0 }, end: { lat: 1, lng: 1 }
            });

        const p0 = response.body.data.results[0].polyline[0];
        expect(p0.lat).toBe(51.5);
        expect(p0.is_charging_stop).toBe(false);
        expect(p0.charger_type).toBe('NONE');
        expect(p0.kw_output).toBe(0);
        expect(p0.planned_soc_pct).toBe(0);
    });
});
