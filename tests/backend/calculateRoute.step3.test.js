const request = require('supertest');
const app = require('../../modules/backend/index');
const { calculateRouteGrpc } = require('../../modules/backend/services/grpcClient');

const expectedMaxNodes = parseInt(process.env.ALGO_MAX_NODES) || 1000000;


// Mock dependencies to prevent async leaks
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

describe('POST /api/routes/calculate (Step 3: Suite Results)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return 200 and a 5-algorithm result suite', async () => {
        const mockResults = [
            { algorithm: 'BFS', distance: 1000, duration: 300, nodes_expanded: 50, exec_time_ms: 0.1, path_cost: 1000, polyline: [] },
            { algorithm: 'Dijkstra', distance: 1000, duration: 300, nodes_expanded: 40, exec_time_ms: 0.2, path_cost: 1000, polyline: [] },
            { algorithm: 'IDDFS', distance: 1000, duration: 300, nodes_expanded: 100, exec_time_ms: 0.5, path_cost: 1000, polyline: [] },
            { algorithm: 'A*', distance: 1000, duration: 300, nodes_expanded: 20, exec_time_ms: 0.1, path_cost: 1000, polyline: [] },
            { algorithm: 'IDA*', distance: 1000, duration: 300, nodes_expanded: 30, exec_time_ms: 0.3, path_cost: 1000, polyline: [] }
        ];
        
        calculateRouteGrpc.mockResolvedValue({
            results: mockResults
        });

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 40.7128, lng: -74.0060 },
                end: { lat: 40.7306, lng: -73.9866 },
                mock_hour: 14,
                objective: 'FASTEST'
            });
            
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.results).toHaveLength(5);
        
        const firstResult = response.body.data.results[0];
        expect(firstResult.algorithm).toBe('BFS');
        expect(firstResult.nodes_expanded).toBe(50);
        expect(firstResult).toHaveProperty('exec_time_ms');
        expect(firstResult).toHaveProperty('path_cost');

        expect(calculateRouteGrpc).toHaveBeenCalledWith(expect.objectContaining({
            start: { lat: 40.7128, lng: -74.0060 },
            end: { lat: 40.7306, lng: -73.9866 },
            mockHour: 14,
            objective: 'FASTEST',
            mapDataPb: null,
            regionId: ''
        }));
    });

    it('should use default mock_hour (12) and objective (FASTEST) if not provided', async () => {
        calculateRouteGrpc.mockResolvedValue({ results: [] });

        await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 40.7128, lng: -74.0060 },
                end: { lat: 40.7306, lng: -73.9866 }
            });

        expect(calculateRouteGrpc).toHaveBeenCalledWith(expect.objectContaining({
            start: expect.anything(),
            end: expect.anything(),
            mockHour: 12,
            objective: 'FASTEST',
            mapDataPb: null,
            regionId: ''
        }));
    });

    it('should handle empty results gracefully', async () => {
        calculateRouteGrpc.mockResolvedValue({ results: null });

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 40.7128, lng: -74.0060 },
                end: { lat: 40.7306, lng: -73.9866 }
            });

        expect(response.status).toBe(200);
        expect(response.body.data.results).toEqual([]);
    });

    it('should validate mock_hour range (0-23)', async () => {
        calculateRouteGrpc.mockResolvedValue({ results: [] });

        // Invalid hour should fallback to 12
        await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 40.7128, lng: -74.0060 },
                end: { lat: 40.7306, lng: -73.9866 },
                mock_hour: 25
            });

        expect(calculateRouteGrpc).toHaveBeenCalledWith(expect.objectContaining({
            start: expect.anything(),
            end: expect.anything(),
            mockHour: 12,
            objective: expect.anything(),
            mapDataPb: null,
            regionId: ''
        }));
    });
});
