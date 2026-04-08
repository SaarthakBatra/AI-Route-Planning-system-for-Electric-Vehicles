/**
 * @fileoverview Rigorous Integration Tests for OSM Dynamic Ingestion.
 * 
 * Verifies the orchestration between the Backend controller, Cache worker, 
 * and gRPC client.
 */

const calculateRouteController = require('../../modules/backend/controllers/calculateRoute');
const { calculateBBox } = require('../../modules/backend/utils/bbox');
const { getMapPayload } = require('../../modules/cache/services/osmWorker');
const { calculateRouteGrpc } = require('../../modules/backend/services/grpcClient');
const logger = require('../../modules/backend/utils/logger');

const expectedMaxNodes = parseInt(process.env.ALGO_MAX_NODES) || 1000000;


// Mocks
jest.mock('../../modules/cache/services/redisClient', () => ({
    client: {
        on: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
        zadd: jest.fn(),
        zcard: jest.fn(),
        zrange: jest.fn(),
        del: jest.fn(),
        zrem: jest.fn(),
        status: 'ready'
    },
    pingRedis: jest.fn()
}));
jest.mock('../../modules/cache/services/osmWorker');
jest.mock('../../modules/backend/services/grpcClient');
jest.mock('../../modules/backend/utils/logger');


describe('OSM Integration Suite', () => {
    let req, res;

    beforeEach(() => {
        req = {
            body: {
                start: { lat: 28.36, lng: 75.59 },
                end: { lat: 28.37, lng: 75.60 },
                mock_hour: 10,
                objective: 'FASTEST'
            }
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        jest.clearAllMocks();
    });

    test('1. BBox Calculation Accuracy', () => {
        const start = { lat: 10.0, lng: 20.0 };
        const end = { lat: 10.1, lng: 20.1 };
        const bbox = calculateBBox(start, end, 0.01);

        expect(bbox).toEqual({
            minLat: 9.99,
            minLon: 19.99,
            maxLat: 10.11,
            maxLon: 20.11
        });
    });

    test('2. Successful OSM Ingestion & gRPC Dispatch', async () => {
        const mockMapData = Buffer.from('mock pb data');
        getMapPayload.mockResolvedValue({ binary: mockMapData, region_id: 'bbox:1' });
        calculateRouteGrpc.mockResolvedValue({ results: [] });

        await calculateRouteController(req, res);

        // Verify OSM worker was called with correct bbox (quantized with 0.1 buffer)
        expect(getMapPayload).toHaveBeenCalledWith({
            minLat: 28.26, 
            minLon: 75.49, 
            maxLat: 28.47, 
            maxLon: 75.70  
        });

        // Verify gRPC client received binary map data
        expect(calculateRouteGrpc).toHaveBeenCalledWith(expect.objectContaining({
            start: req.body.start,
            end: req.body.end,
            mockHour: 10,
            objective: 'FASTEST',
            mapDataPb: mockMapData,
            regionId: 'bbox:1'
        }));

        // Verify Stage 5 Protobuf log
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('Protobuf Ingestion Triggered')
        );
    });

    test('3. Graceful Fallback on Cache/Overpass Failure', async () => {
        getMapPayload.mockRejectedValue(new Error('Overpass Timeout'));
        calculateRouteGrpc.mockResolvedValue({ results: [] });

        await calculateRouteController(req, res);

        // Verify response is still successful (controller returns 503 on ingestion failure)
        expect(res.status).toHaveBeenCalledWith(503);
    });

    test('4. Handling Empty OSM Result gracefully', async () => {
        getMapPayload.mockResolvedValue({ binary: null, region_id: '' }); 
        calculateRouteGrpc.mockResolvedValue({ results: [] });

        await calculateRouteController(req, res);

        // Verify gRPC was called with null map data
        expect(calculateRouteGrpc).toHaveBeenCalledWith(expect.objectContaining({
            start: expect.anything(),
            end: expect.anything(),
            mockHour: expect.anything(),
            objective: expect.anything(),
            mapDataPb: null,
            regionId: ''
        }));
    });
});
