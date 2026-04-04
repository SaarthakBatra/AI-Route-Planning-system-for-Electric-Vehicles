/**
 * @fileoverview Unit tests for modules/database/services/mongoClient.js
 *
 * Strategy: Jest mock for 'mongoose'.
 * No live MongoDB Atlas connection is required — all Mongoose calls are intercepted.
 *
 * Test coverage:
 *  1. connectMongo() resolves when mongoose.connect() succeeds.
 *  2. Logger [CALL] is emitted on function entry.
 *  3. Logger [DONE] is emitted on function exit with readyState.
 *  4. connectMongo() rejects and logs [ERROR] when mongoose.connect() throws.
 *  5. disconnectMongo() calls mongoose.disconnect() and logs [DONE].
 *  6. connectMongo() throws immediately if MONGO_URI is a placeholder.
 */

// ─── Mock dotenv so it doesn't fail looking for .env ────────────────────────
jest.mock('dotenv', () => ({
    config: jest.fn(),
}));

// ─── Mock mongoose BEFORE requiring the module under test ────────────────────
jest.mock('mongoose', () => {
    const mockConnection = {
        host: 'cluster0.testmock.mongodb.net',
        readyState: 1,
        on: jest.fn(),
    };

    return {
        connect: jest.fn(),
        disconnect: jest.fn(),
        connection: mockConnection,
    };
});

// ─── Mock the logger ─────────────────────────────────────────────────────────
jest.mock('../../modules/database/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    call: jest.fn(),
    done: jest.fn(),
}));

const mongoose = require('mongoose');
const logger = require('../../modules/database/utils/logger');

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Database: mongoClient.js', () => {
    let connectMongo;
    let disconnectMongo;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();

        // Set a valid-looking (non-placeholder) MONGO_URI for most tests
        process.env.MONGO_URI =
            'mongodb+srv://testuser:testpass@cluster0.testmock.mongodb.net/ai_route_planner?retryWrites=true&w=majority';

        // Re-require after resetting modules and env to pick up new MONGO_URI
        jest.mock('dotenv', () => ({ config: jest.fn() }));
        jest.mock('mongoose', () => {
            const mockConnection = {
                host: 'cluster0.testmock.mongodb.net',
                readyState: 1,
                on: jest.fn(),
            };
            return { connect: jest.fn(), disconnect: jest.fn(), connection: mockConnection };
        });
        jest.mock('../../modules/database/utils/logger', () => ({
            info: jest.fn(), error: jest.fn(), warn: jest.fn(),
            debug: jest.fn(), call: jest.fn(), done: jest.fn(),
        }));

        ({ connectMongo, disconnectMongo } = require('../../modules/database/services/mongoClient'));
    });

    // ── Test 1: Happy path ────────────────────────────────────────────────────
    it('connectMongo() resolves when mongoose.connect() succeeds', async () => {
        const mongoose = require('mongoose');
        mongoose.connect.mockResolvedValue(undefined);

        await expect(connectMongo()).resolves.toBe(1);
        expect(mongoose.connect).toHaveBeenCalledTimes(1);
    });

    // ── Test 2: [CALL] is logged on entry ─────────────────────────────────────
    it('logs [CALL] on function entry with masked URI', async () => {
        const mongoose = require('mongoose');
        const logger = require('../../modules/database/utils/logger');
        mongoose.connect.mockResolvedValue(undefined);

        await connectMongo();

        expect(logger.call).toHaveBeenCalledWith(
            'connectMongo',
            expect.stringContaining('MONGO_URI:')
        );
        // Ensure the real password is NOT logged
        expect(logger.call).toHaveBeenCalledWith(
            'connectMongo',
            expect.not.stringContaining('testpass')
        );
    });

    // ── Test 3: [DONE] is logged with readyState on success ───────────────────
    it('logs [DONE] with readyState=1 on successful connection', async () => {
        const mongoose = require('mongoose');
        const logger = require('../../modules/database/utils/logger');
        mongoose.connect.mockResolvedValue(undefined);

        await connectMongo();

        expect(logger.done).toHaveBeenCalledWith(
            'connectMongo',
            expect.stringContaining('readyState=')
        );
    });

    // ── Test 4: Error path ────────────────────────────────────────────────────
    it('connectMongo() rejects and logs [ERROR] when mongoose.connect() throws', async () => {
        const mongoose = require('mongoose');
        const logger = require('../../modules/database/utils/logger');
        const dbError = new Error('MongoServerSelectionError: connection timed out');
        mongoose.connect.mockRejectedValue(dbError);

        await expect(connectMongo()).rejects.toThrow('MongoServerSelectionError');
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('connectMongo failed')
        );
    });

    // ── Test 5: disconnectMongo() works correctly ──────────────────────────────
    it('disconnectMongo() calls mongoose.disconnect() and logs [DONE]', async () => {
        const mongoose = require('mongoose');
        const logger = require('../../modules/database/utils/logger');
        mongoose.disconnect.mockResolvedValue(undefined);

        await disconnectMongo();

        expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
        expect(logger.done).toHaveBeenCalledWith('disconnectMongo', 'Connection closed');
    });

    // ── Test 6: Placeholder URI guard ─────────────────────────────────────────
    it('connectMongo() throws immediately if MONGO_URI contains placeholder text', async () => {
        // Override env with unconfigured placeholder
        process.env.MONGO_URI =
            'mongodb+srv://<username>:<password>@<cluster>.mongodb.net/ai_route_planner';

        jest.resetModules();
        jest.mock('dotenv', () => ({ config: jest.fn() }));
        jest.mock('mongoose', () => ({
            connect: jest.fn(), disconnect: jest.fn(),
            connection: { host: '', readyState: 0, on: jest.fn() },
        }));
        jest.mock('../../modules/database/utils/logger', () => ({
            info: jest.fn(), error: jest.fn(), warn: jest.fn(),
            debug: jest.fn(), call: jest.fn(), done: jest.fn(),
        }));

        const { connectMongo: connectWithPlaceholder } = require('../../modules/database/services/mongoClient');

        await expect(connectWithPlaceholder()).rejects.toThrow(
            'MONGO_URI is not configured'
        );
    });
});
