/**
 * @fileoverview Rigorous Unit Tests for modules/cache/services/osmWorker.js
 * 
 * Strategy:
 *  - Mock 'ioredis' for Redis operations.
 *  - Mock global 'fetch' for OSM API calls.
 *  - Spy on 'logger' to verify CALL/DONE patterns.
 * 
 * Coverage:
 *  1. Quantization decimal precision (~11m accuracy).
 *  2. Cache HIT flow (Fast path).
 *  3. Cache MISS flow (Ingestion).
 *  4. LRU Eviction Logic (Metadata ZSET tracking + Pruning).
 *  5. Concurrent Request Memoization (Race condition protection).
 *  6. Error handling for OSM API failures.
 */

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRedisClient = {
    get: jest.fn(),
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

const { getMapData, getBBoxKey, quantize } = require('../../modules/cache/services/osmWorker');
const logger = require('../../modules/cache/utils/logger');

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Cache: osmWorker.js', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default MAX_CACHE_ENTRIES is 1000 in .env
    });

    // ── 1. Quantization & Hashing ─────────────────────────────────────────────
    describe('Quantization & Key Generation', () => {
        it('quantizes coordinates to exactly 4 decimal places', () => {
            expect(quantize(51.50004)).toBe(51.5000);
            expect(quantize(51.50005)).toBe(51.5001);
            expect(quantize(-0.1234567)).toBe(-0.1235);
        });

        it('generates the same key for bboxes within ~11m (quantized overlap)', () => {
            const bboxA = { minLat: 40.71271, minLon: -74.00591, maxLat: 40.71301, maxLon: -74.00501 };
            const bboxB = { minLat: 40.71274, minLon: -74.00594, maxLat: 40.71304, maxLon: -74.00504 };
            expect(getBBoxKey(bboxA)).toBe(getBBoxKey(bboxB));
        });

        it('generates different keys for bboxes shifted > 15m', () => {
            const bboxA = { minLat: 40.7127, minLon: -74.0059, maxLat: 40.7130, maxLon: -74.0050 };
            const bboxB = { minLat: 40.7128, minLon: -74.0059, maxLat: 40.7131, maxLon: -74.0050 };
            expect(getBBoxKey(bboxA)).not.toBe(getBBoxKey(bboxB));
        });
    });

    // ── 2. Cache HIT ──────────────────────────────────────────────────────────
    describe('getMapData: Cache HIT', () => {
        it('returns parsed data from Redis and updates LRU metadata', async () => {
            const bbox = { minLat: 51, minLon: 0, maxLat: 51.1, maxLon: 0.1 };
            const mockData = { elements: [{ id: 1 }] };
            mockRedisClient.get.mockResolvedValue(JSON.stringify(mockData));

            const result = await getMapData(bbox);

            expect(result).toEqual(mockData);
            expect(mockRedisClient.zadd).toHaveBeenCalledWith('osm_metadata', expect.any(Number), expect.any(String));
            expect(fetch).not.toHaveBeenCalled();
            expect(logger.done).toHaveBeenCalledWith('getMapData', 'HIT');
        });
    });

    // ── 3. Cache MISS & Ingestion ─────────────────────────────────────────────
    describe('getMapData: Cache MISS', () => {
        it('fetches from OSM, stores in Redis, and performs eviction check', async () => {
            const bbox = { minLat: 51, minLon: 0, maxLat: 51.1, maxLon: 0.1 };
            const mockData = { elements: [{ id: 2 }] };
            
            mockRedisClient.get.mockResolvedValue(null);
            fetch.mockResolvedValue({
                ok: true,
                json: async () => mockData,
            });
            mockRedisClient.zcard.mockResolvedValue(500); // Below limit

            const result = await getMapData(bbox);

            expect(fetch).toHaveBeenCalled();
            expect(mockRedisClient.set).toHaveBeenCalled();
            expect(mockRedisClient.zadd).toHaveBeenCalled(); // New entry metadata
            expect(result).toEqual(mockData);
            expect(mockRedisClient.del).not.toHaveBeenCalled(); // No eviction needed
        });
    });

    // ── 4. LRU Eviction ───────────────────────────────────────────────────────
    describe('getMapData: LRU Eviction', () => {
        it('evicts the oldest entry when cache size exceeds limit', async () => {
            const bbox = { minLat: 51, minLon: 0, maxLat: 51.1, maxLon: 0.1 };
            const mockData = { elements: [] };
            
            mockRedisClient.get.mockResolvedValue(null);
            fetch.mockResolvedValue({ ok: true, json: async () => mockData });
            mockRedisClient.zcard.mockResolvedValue(1001); // Exceeds limit
            mockRedisClient.zrange.mockResolvedValue(['osm:data:old_key']);

            await getMapData(bbox);

            expect(mockRedisClient.del).toHaveBeenCalledWith('osm:data:old_key');
            expect(mockRedisClient.zrem).toHaveBeenCalledWith('osm_metadata', 'osm:data:old_key');
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Evicting oldest entry'));
        });
    });

    // ── 5. Concurrent Requests (Memoization) ──────────────────────────────────
    describe('getMapData: Concurrent Requests', () => {
        it('prevents redundant OSM calls for identical concurrent requests', async () => {
            const bbox = { minLat: 51, minLon: 0, maxLat: 51.1, maxLon: 0.1 };
            const mockData = { elements: [] };
            
            mockRedisClient.get.mockResolvedValue(null);
            
            // Mock a delayed fetch
            fetch.mockImplementation(() => new Promise(resolve => {
                setTimeout(() => resolve({ ok: true, json: async () => mockData }), 50);
            }));

            // Fire multiple requests simultaneously
            const results = await Promise.all([
                getMapData(bbox),
                getMapData(bbox),
                getMapData(bbox)
            ]);

            // Assertions
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(results[0]).toEqual(mockData);
            expect(results[1]).toEqual(mockData);
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Attaching to pending fetch'));
        });
    });

    // ── 6. Error Handling ─────────────────────────────────────────────────────
    describe('getMapData: Error Handling', () => {
        it('throws and logs error when OSM API fails', async () => {
            const bbox = { minLat: 51, minLon: 0, maxLat: 51.1, maxLon: 0.1 };
            mockRedisClient.get.mockResolvedValue(null);
            fetch.mockResolvedValue({
                ok: false,
                status: 504,
                statusText: 'Gateway Timeout'
            });

            await expect(getMapData(bbox)).rejects.toThrow('OSM API error');
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('OSM Fetch Failed'));
        });
    });
});
