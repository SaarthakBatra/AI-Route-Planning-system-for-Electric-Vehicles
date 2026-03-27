/**
 * @fileoverview Unit tests for modules/cache/services/redisClient.js
 *
 * Strategy: Jest manual mock for 'ioredis'.
 * No live Redis instance is required — all I/O is intercepted.
 *
 * Test coverage:
 *  1. pingRedis() resolves with "PONG" on successful connection.
 *  2. Logger [CALL] is emitted on function entry.
 *  3. Logger [DONE] is emitted on function exit with correct output.
 *  4. pingRedis() rejects and logs [ERROR] when Redis throws.
 */

// ─── Mock ioredis BEFORE requiring the module under test ────────────────────
jest.mock('ioredis', () => {
    const mockEmitter = {
        _listeners: {},
        on(event, handler) {
            this._listeners[event] = handler;
            return this;
        },
        emit(event, ...args) {
            if (this._listeners[event]) {
                this._listeners[event](...args);
            }
        },
        // Will be overridden per test
        ping: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
        quit: jest.fn().mockResolvedValue('OK'),
    };

    // ioredis is a class — return a constructor that produces mockEmitter
    const MockRedis = jest.fn(() => mockEmitter);
    return MockRedis;
});

// ─── Mock dotenv so it doesn't fail looking for .env ────────────────────────
jest.mock('dotenv', () => ({
    config: jest.fn(),
}));

// ─── Mock the logger to spy on calls without polluting test output ───────────
jest.mock('../../modules/cache/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    call: jest.fn(),
    done: jest.fn(),
}));

const logger = require('../../modules/cache/utils/logger');
// Require AFTER mocks are established
const { pingRedis } = require('../../modules/cache/services/redisClient');

// ─── Capture shared mock client once (before clearAllMocks wipes mock.results) ─
const Redis = require('ioredis');
const mockClient = Redis.mock.results[0]?.value;

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Cache: redisClient.js', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Restore default happy-path behaviour after each clearAllMocks()
        if (mockClient) {
            mockClient.ping.mockResolvedValue('PONG');
        }
    });

    // ── Test 1: Happy path ────────────────────────────────────────────────────
    it('pingRedis() resolves with "PONG" on success', async () => {
        const result = await pingRedis();
        expect(result).toBe('PONG');
    });

    // ── Test 2: [CALL] is logged on entry ─────────────────────────────────────
    it('logs [CALL] with function name and "none" input on entry', async () => {
        await pingRedis();
        expect(logger.call).toHaveBeenCalledWith('pingRedis', 'none');
    });

    // ── Test 3: [DONE] is logged on success ───────────────────────────────────
    it('logs [DONE] with "PONG" output on successful ping', async () => {
        await pingRedis();
        expect(logger.done).toHaveBeenCalledWith('pingRedis', 'PONG');
    });

    // ── Test 4: Error path ────────────────────────────────────────────────────
    it('pingRedis() rejects and logs [ERROR] when Redis throws', async () => {
        const redisError = new Error('ECONNREFUSED 127.0.0.1:6379');
        if (mockClient) mockClient.ping.mockRejectedValue(redisError);

        await expect(pingRedis()).rejects.toThrow('ECONNREFUSED 127.0.0.1:6379');
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('pingRedis failed')
        );
    });

    // ── Test 5: INFO log shows PING response ─────────────────────────────────
    it('logs [INFO] with the raw PONG response on success', async () => {
        await pingRedis();
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('PONG')
        );
    });
});
