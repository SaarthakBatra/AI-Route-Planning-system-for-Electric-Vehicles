/**
 * @fileoverview Rigorous Unit Tests for Protobuf Serialization in modules/cache.
 * 
 * Strategy:
 *  - Use real proto file for conversion verification.
 *  - Mock Redis and OSM API.
 *  - Validate Node/Edge mapping and Haversine accuracy.
 */

const mockRedisClient = {
    get: jest.fn(),
    getBuffer: jest.fn(),
    set: jest.fn(),
    zadd: jest.fn(),
    zcard: jest.fn(),
    zrange: jest.fn(),
    del: jest.fn(),
    zrem: jest.fn(),
};

jest.mock('../../modules/cache/services/redisClient', () => ({
    client: mockRedisClient,
}));

jest.mock('../../modules/cache/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    call: jest.fn(),
    done: jest.fn(),
}));

// Mock native fetch
global.fetch = jest.fn();

const { getMapPayload, convertToMapPayload, getRegionId } = require('../../modules/cache/services/osmWorker');
const protobuf = require('protobufjs');
const path = require('path');

describe('Cache: Protobuf Serialization', () => {
    const PROTO_PATH = path.resolve(__dirname, '../../modules/routing_engine/proto/route_engine.proto');

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getRegionId', () => {
        it('generates a consistent bbox string', () => {
            const bbox = { minLat: 51.5, minLon: -0.1, maxLat: 51.6, maxLon: 0.0 };
            expect(getRegionId(bbox)).toBe('bbox:51.5_-0.1_51.6_0');
        });
    });

    describe('convertToMapPayload', () => {
        it('correctly transforms OSM JSON to MapPayload Protobuf', async () => {
            const mockOsmData = {
                elements: [
                    { type: 'node', id: 101, lat: 51.5074, lon: -0.1278, tags: { name: 'Nelson Column' } },
                    { type: 'node', id: 102, lat: 51.5085, lon: -0.1285, tags: { name: 'National Gallery' } },
                    { 
                        type: 'way', 
                        id: 201, 
                        nodes: [101, 102], 
                        tags: { highway: 'primary', maxspeed: '40' } 
                    }
                ]
            };

            const binary = await convertToMapPayload(mockOsmData);
            expect(binary).toBeInstanceOf(Buffer);

            // Decode Protobuf binary
            const root = await protobuf.load(PROTO_PATH);
            const MapPayload = root.lookupType('route_engine.MapPayload');
            const message = MapPayload.decode(binary);
            const decoded = MapPayload.toObject(message);

            // Verify Nodes
            expect(decoded.nodes).toHaveLength(2);
            expect(decoded.nodes[0].name).toBe('Nelson Column');
            expect(decoded.nodes[1].id).toBe(1); // sequential internal ID

            // Verify Edges (protobufjs uses camelCase: speedKmh, roadType, weightM)
            expect(decoded.edges).toHaveLength(1);
            expect(decoded.edges[0].u).toBe(0);
            expect(decoded.edges[0].v).toBe(1);
            expect(decoded.edges[0].speedKmh).toBe(40);
            expect(decoded.edges[0].roadType).toBe('primary');
            expect(decoded.edges[0].weightM).toBeGreaterThan(100); // Haversine distance
        });

        it('uses default speeds when maxspeed tag is missing', async () => {
            const mockOsmData = {
                elements: [
                    { type: 'node', id: 1, lat: 51.5, lon: -0.1 },
                    { type: 'node', id: 2, lat: 51.6, lon: -0.2 },
                    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'motorway' } }
                ]
            };

            const binary = await convertToMapPayload(mockOsmData);
            const root = await protobuf.load(PROTO_PATH);
            const MapPayload = root.lookupType('route_engine.MapPayload');
            const message = MapPayload.decode(binary);
            const decoded = MapPayload.toObject(message);

            expect(decoded.edges[0].speedKmh).toBe(120); // Default for motorway
        });
    });

    describe('getMapPayload: E2E Caching Flow', () => {
        it('returns cached binary on hit', async () => {
            const bbox = { minLat: 51, minLon: 0, maxLat: 51.1, maxLon: 0.1 };
            const mockBuffer = Buffer.from('dummy-proto-binary');
            mockRedisClient.getBuffer.mockResolvedValue(mockBuffer);

            const result = await getMapPayload(bbox);

            expect(result.binary).toEqual(mockBuffer);
            expect(result.region_id).toBeDefined();
            expect(mockRedisClient.getBuffer).toHaveBeenCalled();
            expect(fetch).not.toHaveBeenCalled();
        });

        it('ingests, serializes, and caches on miss', async () => {
            const bbox = { minLat: 51, minLon: 0, maxLat: 51.1, maxLon: 0.1 };
            const mockOsmData = { elements: [{ type: 'node', id: 1, lat: 51, lon: 0 }] };
            
            mockRedisClient.getBuffer.mockResolvedValue(null);
            fetch.mockResolvedValue({
                ok: true,
                json: async () => mockOsmData
            });
            mockRedisClient.zcard.mockResolvedValue(0);

            const result = await getMapPayload(bbox);

            expect(result.binary).toBeInstanceOf(Uint8Array); // Protobuf output
            expect(mockRedisClient.set).toHaveBeenCalled();
            expect(mockRedisClient.zadd).toHaveBeenCalled();
        });
    });
});
