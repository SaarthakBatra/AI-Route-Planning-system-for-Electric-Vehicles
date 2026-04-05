const request = require('supertest');
const app = require('../../modules/backend/index');
const { calculateRouteGrpc } = require('../../modules/backend/services/grpcClient');
const { getMapPayload } = require('../../modules/cache/services/osmWorker');

// Mock dependencies
jest.mock('../../modules/backend/services/grpcClient', () => ({
    calculateRouteGrpc: jest.fn()
}));
jest.mock('../../modules/cache/services/osmWorker', () => ({
    getMapPayload: jest.fn()
}));

describe('Protobuf Orchestration Test (Step 4)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should fetch binary payload and pass it to gRPC', async () => {
        const mockBinary = Buffer.from('mock-protobuf-binary');
        const mockRegionId = 'bbox:40.7128_-74.006_40.7306_-73.9866';
        
        getMapPayload.mockResolvedValue({
            binary: mockBinary,
            region_id: mockRegionId
        });

        calculateRouteGrpc.mockResolvedValue({
            results: [
                {
                    algorithm: 'Dijkstra',
                    polyline: [],
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
                end: { lat: 40.7306, lng: -73.9866 },
                mock_hour: 14,
                objective: 'FASTEST'
            });
            
        expect(response.status).toBe(200);
        expect(getMapPayload).toHaveBeenCalled();
        
        // Verify gRPC was called with binary data and region_id
        expect(calculateRouteGrpc).toHaveBeenCalledWith(
            { lat: 40.7128, lng: -74.0060 },
            { lat: 40.7306, lng: -73.9866 },
            14,
            'FASTEST',
            mockBinary,
            mockRegionId
        );
    });

    it('should fallback to static mode if getMapPayload fails', async () => {
        getMapPayload.mockRejectedValue(new Error('Cache service down'));

        calculateRouteGrpc.mockResolvedValue({
            results: []
        });

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 40.7128, lng: -74.0060 },
                end: { lat: 40.7306, lng: -73.9866 }
            });
            
        expect(response.status).toBe(200);
        // Verify gRPC was called with null binary and empty region_id
        expect(calculateRouteGrpc).toHaveBeenCalledWith(
            { lat: 40.7128, lng: -74.0060 },
            { lat: 40.7306, lng: -73.9866 },
            12, // Default hour
            'FASTEST', // Default objective
            null,
            ''
        );
    });
});
