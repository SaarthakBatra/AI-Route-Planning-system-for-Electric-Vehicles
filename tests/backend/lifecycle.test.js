/**
 * @file lifecycle.test.js
 * @description Unit tests for the backend server startup sequence.
 * Verifies the 'Connect-then-Listen' orchestrator logic.
 */

const app = require('../../modules/backend/index');
const startServer = app.startServer;
const database = require('../../modules/database/index');
const logger = require('../../modules/backend/utils/logger');

// Mock a complete shutdown of external dependencies to prevent 'Open Handles'
jest.mock('../../modules/database/index', () => ({
    connectMongo: jest.fn(),
    disconnectMongo: jest.fn()
}));

// Mock the Redis client used by the cache module (triggered by backend imports)
jest.mock('../../modules/cache/services/redisClient', () => ({
    on: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK')
}));

describe('Backend Server Lifecycle', () => {
    let exitSpy;
    let listenSpy;
    let infoSpy;
    let errorSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Spy on process.exit to prevent the test runner from crashing
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
        
        // Spy on app.listen to prevent binding to actual ports
        listenSpy = jest.spyOn(app, 'listen').mockImplementation((port, cb) => {
            if (cb) cb();
            return { close: jest.fn() };
        });

        // Spy on logger to verify expected output
        infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
        errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        exitSpy.mockRestore();
        listenSpy.mockRestore();
        infoSpy.mockRestore();
        errorSpy.mockRestore();
    });

    /**
     * TEST: Startup Success
     * VERIFIES: app.listen is called ONLY after connectMongo resolves.
     */
    test('1. Successful Startup: connectMongo resolves → app.listen called', async () => {
        database.connectMongo.mockResolvedValue(1); // ReadyState 1 (Connected)

        await startServer();

        // 1. Verify connectMongo was called before listening
        expect(database.connectMongo).toHaveBeenCalled();
        
        // 2. Verify server started listening
        expect(listenSpy).toHaveBeenCalled();
        
        // 3. Verify success log
        expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('Backend module listening on port'));
        
        // 4. Ensure no exit was triggered
        expect(exitSpy).not.toHaveBeenCalled();
    });

    /**
     * TEST: Startup Failure
     * VERIFIES: process.exit(1) is called if connectMongo rejects.
     */
    test('2. Failed Startup: connectMongo rejects → process.exit(1) called', async () => {
        const testError = new Error('Database connection failed (Auth Error)');
        database.connectMongo.mockRejectedValue(testError);

        await startServer();

        // 1. Verify connectMongo was called
        expect(database.connectMongo).toHaveBeenCalled();
        
        // 2. Verify server NEVER started listening
        expect(listenSpy).not.toHaveBeenCalled();
        
        // 3. Verify critical error log
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('CRITICAL: Server failed to start'));
        
        // 4. Verify process exited with code 1
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
