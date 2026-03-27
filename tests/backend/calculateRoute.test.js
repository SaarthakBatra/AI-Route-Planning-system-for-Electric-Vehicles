const request = require('supertest');
const app = require('../../modules/backend/index');
const { calculateRouteGrpc } = require('../../modules/backend/services/grpcClient');

// Mock the gRPC client
jest.mock('../../modules/backend/services/grpcClient', () => ({
    calculateRouteGrpc: jest.fn()
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
            polyline: mockPolyline,
            distance: 1000,
            duration: 300
        });

        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 40.7128, lng: -74.0060 },
                end: { lat: 40.7306, lng: -73.9866 }
            });
            
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.path).toHaveLength(3);
        
        const path = response.body.data.path;
        expect(path[0].lat).toBe(40.7128);
        expect(path[2].lat).toBe(40.7306);
        expect(calculateRouteGrpc).toHaveBeenCalledWith(
            { lat: 40.7128, lng: -74.0060 },
            { lat: 40.7306, lng: -73.9866 }
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
