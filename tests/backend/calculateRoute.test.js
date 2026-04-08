const request = require('supertest');
const app = require('../../modules/backend/index');
const { calculateRouteGrpc } = require('../../modules/backend/services/grpcClient');

// Mock dependencies
jest.mock('../../modules/backend/services/grpcClient', () => ({
    calculateRouteGrpc: jest.fn()
}));
jest.mock('../../modules/cache/services/osmWorker', () => ({
    getMapPayload: jest.fn().mockResolvedValue({ binary: null, region_id: '' })
}));
jest.mock('../../modules/database', () => ({
    connectMongo: jest.fn().mockResolvedValue(),
    disconnectMongo: jest.fn().mockResolvedValue()
}));

describe('POST /api/routes/calculate (v2.3.0 Sync)', () => {
    const backupEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset process.env to a predictable state for each test
        process.env = { 
            ...backupEnv,
            ALGO_MAX_NODES: '10000000',
            ALGO_KILL_TIME_MS: '60000', // v2.3.0 Default
            ALGO_DEBUG_NODE_INTERVAL: '5000',
            ALGO_DEBUG: 'false'
        };
    });

    afterAll(() => {
        process.env = backupEnv;
    });

    it('should return 400 if coordinates are missing', async () => {
        const response = await request(app).post('/api/routes/calculate').send({});
        expect(response.status).toBe(400);
    });

    it('should use v2.3.0 default kill-time-ms (60000)', async () => {
        calculateRouteGrpc.mockResolvedValue({ results: [] });

        await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 40.7128, lng: -74.0060 },
                end: { lat: 40.7306, lng: -73.9866 }
            });

        expect(calculateRouteGrpc).toHaveBeenCalledWith(expect.objectContaining({
            killTimeMs: 60000
        }));
    });

    it('should detect Native I/O truncation and append directory pointer', async () => {
        const logDirMarker = 'test_truncation_dir';
        calculateRouteGrpc.mockResolvedValue({
            results: [
                {
                    algorithm: 'Dijkstra',
                    debug_logs: 'Some initial logs... (TRUNCATED: Native I/O...)',
                    nodes_expanded: 5000
                }
            ]
        });

        // Spy on getAndIncrementUID or just rely on the controller's logDir generation
        // For testing purposes, we'll check if the pattern matches.
        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 0, lng: 0 },
                end: { lat: 1, lng: 1 }
            });

        expect(response.status).toBe(200);
        const result = response.body.data.results[0];
        expect(result.debug_logs).toContain('(TRUNCATED: Native I/O...)');
        expect(result.debug_logs).toContain('[NOTICE] Granular logging offloaded to Direct I/O');
        expect(result.debug_logs).toContain('Output/');
        expect(result.debug_logs).toContain('Algo_Dijkstra.md');
    });

    it('should propagate v2.5.1 metadata in polyline coordinates', async () => {
        calculateRouteGrpc.mockResolvedValue({
            results: [
                {
                    algorithm: 'AStar',
                    polyline: [
                        { 
                            lat: 40.7128, lng: -74.0060, 
                            segment_consumed_kwh: 0.05, 
                            is_charging_stop: false,
                            is_regen: false,
                            charger_type: 'NONE',
                            kw_output: 0,
                            is_operational: true,
                            planned_soc_kwh: 50.0
                        },
                        { 
                            lat: 40.7306, lng: -73.9866, 
                            segment_consumed_kwh: -0.02, 
                            is_charging_stop: true,
                            is_regen: true,
                            charger_type: 'DC_FAST',
                            kw_output: 50,
                            is_operational: true,
                            planned_soc_kwh: 50.02
                        }
                    ],
                    nodes_expanded: 100
                }
            ]
        });

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 0, lng: 0 },
                end: { lat: 1, lng: 1 },
                vehicle_id: 'tesla_model_3',
                battery_soh_pct: 100 // Cap: 75kWh
            });

        expect(response.status).toBe(200);
        const result = response.body.data.results[0];
        expect(result.polyline).toHaveLength(2);
        
        // Point 1
        expect(result.polyline[0]).toMatchObject({
            segment_consumed_kwh: 0.05,
            is_charging_stop: false,
            is_regen: false,
            planned_soc_pct: 50 / 75 * 100
        });

        // Point 2
        expect(result.polyline[1]).toMatchObject({
            is_charging_stop: true,
            is_regen: true,
            charger_type: 'DC_FAST',
            kw_output: 50,
            planned_soc_pct: 50.02 / 75 * 100
        });
    });

    it('should maintain legacy behavior if no truncation marker is present', async () => {
        calculateRouteGrpc.mockResolvedValue({
            results: [
                {
                    algorithm: 'AStar',
                    debug_logs: 'Small log trace.',
                    nodes_expanded: 100
                }
            ]
        });

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 0, lng: 0 },
                end: { lat: 1, lng: 1 }
            });

        const result = response.body.data.results[0];
        expect(result.debug_logs).toBe('Small log trace.');
        expect(result.debug_logs).not.toContain('[NOTICE]');
    });
});
