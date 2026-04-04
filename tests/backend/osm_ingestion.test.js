/**
 * @fileoverview Rigorous Integration Tests for OSM Dynamic Ingestion.
 * 
 * Verifies the orchestration between the Backend controller, Cache worker, 
 * and gRPC client.
 */

const calculateRouteController = require('../../modules/backend/controllers/calculateRoute');
const { calculateBBox } = require('../../modules/backend/utils/bbox');
const { getMapData } = require('../../modules/cache/services/osmWorker');
const { calculateRouteGrpc } = require('../../modules/backend/services/grpcClient');
const logger = require('../../modules/backend/utils/logger');

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
        const mockMapData = { elements: [{ type: 'node', id: 1 }] };
        getMapData.mockResolvedValue(mockMapData);
        calculateRouteGrpc.mockResolvedValue({ results: [] });

        await calculateRouteController(req, res);

        // Verify OSM worker was called with correct bbox (quantized)
        expect(getMapData).toHaveBeenCalledWith({
            minLat: 28.35, // 28.36 - 0.01
            minLon: 75.58, // 75.59 - 0.01
            maxLat: 28.38, // 28.37 + 0.01
            maxLon: 75.61  // 75.60 + 0.01
        });

        // Verify gRPC client received stringified map data
        expect(calculateRouteGrpc).toHaveBeenCalledWith(
            req.body.start,
            req.body.end,
            10,
            'FASTEST',
            JSON.stringify(mockMapData)
        );

        // Verify standard logging
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringMatching(/\[BACKEND\] \[INFO\] Map Ingestion Triggered \| Ingested: \d+KB/)
        );
    });

    test('3. Graceful Fallback on Cache/Overpass Failure', async () => {
        getMapData.mockRejectedValue(new Error('Overpass Timeout'));
        calculateRouteGrpc.mockResolvedValue({ results: [] });

        await calculateRouteController(req, res);

        // Verify gRPC was still called but with empty map data
        expect(calculateRouteGrpc).toHaveBeenCalledWith(
            req.body.start,
            req.body.end,
            10,
            'FASTEST',
            ''
        );

        // Verify warning log
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('[BACKEND] [WARN] Map Ingestion Failed | Falling back to static mode: Overpass Timeout')
        );

        // Verify response is still successful (using static engine fallback)
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test('4. Handling Empty OSM Result gracefully', async () => {
        getMapData.mockResolvedValue({ elements: [] }); // No roads found
        calculateRouteGrpc.mockResolvedValue({ results: [] });

        await calculateRouteController(req, res);

        // Since elements.length is 0, we don't log "Ingestion Triggered" and send empty string
        expect(calculateRouteGrpc).toHaveBeenCalledWith(
            req.body.start,
            req.body.end,
            10,
            'FASTEST',
            ''
        );
    });

});
