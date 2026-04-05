const request = require('supertest');
const app = require('../../modules/backend/index');
const { calculateRouteGrpc } = require('../../modules/backend/services/grpcClient');

// Mock dependencies
jest.mock('../../modules/backend/services/grpcClient', () => ({
    calculateRouteGrpc: jest.fn()
}));
jest.mock('../../modules/cache/services/osmWorker', () => ({
    getMapPayload: jest.fn().mockResolvedValue({ binary: null, region_id: '' }) // Default to empty
}));

describe('POST /api/routes/calculate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should return 400 if coordinates are missing', async () => {
        const response = await request(app)
            .post('/api/routes/calculate')
            .send({});
        expect(response.status).toBe(400);
        expect(response.body.error).toBe(true);
    });

    it('should return 400 if coordinates are invalid types', async () => {
        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: '40.7128', lng: -74.0060 },
                end: { lat: 40.7306, lng: -73.9866 }
            });
        expect(response.status).toBe(400);
        expect(response.body.error).toBe(true);
    });

    it('should return 200 and a routed path from gRPC on valid coordinates', async () => {
        const mockPolyline = [
            { lat: 40.7128, lng: -74.0060 },
            { lat: 40.7200, lng: -73.9900 },
            { lat: 40.7306, lng: -73.9866 }
        ];
        
        calculateRouteGrpc.mockResolvedValue({
            results: [
                {
                    algorithm: 'Dijkstra',
                    polyline: mockPolyline,
                    distance: 1000,
                    duration: 300,
                    nodes_expanded: 42,
                    exec_time_ms: 0.15,
                    path_cost: 1000
                }
            ]
        });

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 40.7128, lng: -74.0060 },
                end: { lat: 40.7306, lng: -73.9866 }
            });
            
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.results).toHaveLength(1);
        
        const result = response.body.data.results[0];
        expect(result.polyline).toHaveLength(3);
        expect(result.polyline[0].lat).toBe(40.7128);
        expect(result.distance).toBe(1000);
        expect(result.duration).toBe(300);
        expect(result.nodes_expanded).toBe(42);

        // Verify gRPC was called with binary and region_id (empty in this mock case)
        expect(calculateRouteGrpc).toHaveBeenCalledWith(
            { lat: 40.7128, lng: -74.0060 },
            { lat: 40.7306, lng: -73.9866 },
            12,
            'FASTEST',
            null,
            ''
        );
    });

    
    it('should return 500 if gRPC client fails', async () => {
        calculateRouteGrpc.mockRejectedValue(new Error('gRPC connection failed'));

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 40.7128, lng: -74.0060 },
                end: { lat: 40.7306, lng: -73.9866 }
            });
            
        expect(response.status).toBe(500);
        expect(response.body.error).toBe(true);
    });
});
