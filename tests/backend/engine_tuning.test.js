/**
 * @file engine_tuning.test.js
 * @module tests/backend/engine_tuning
 * @description Verifies synchronization of search optimizations and C++ Native diagnostic parameters.
 * (v2.3.0) Replaces legacy ROUTING_* tests with ALGO_* watchdog and logging tests.
 */
const request = require('supertest');
const app = require('../../modules/backend/index');
const { calculateRouteGrpc } = require('../../modules/backend/services/grpcClient');

jest.mock('../../modules/backend/services/grpcClient', () => ({
    calculateRouteGrpc: jest.fn()
}));
jest.mock('../../modules/cache/services/osmWorker', () => ({
    getMapPayload: jest.fn().mockResolvedValue({ binary: null, region_id: '' })
}));
jest.mock('../../modules/database', () => ({
    connectMongo: jest.fn().mockResolvedValue(),
    disconnectMongo: jest.fn().mockResolvedValue()
}));

const expectedMaxNodes = 10000000;

describe('Engine Tuning & Native C++ Diagnostics (v2.3.0 Sync)', () => {
    const backupEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset environment for tests
        process.env = { ...backupEnv };
        delete process.env.ALGO_MAX_NODES;
        delete process.env.ALGO_KILL_TIME_MS;
        delete process.env.ALGO_DEBUG_NODE_INTERVAL;
        delete process.env.ALGO_DEBUG;
    });

    afterAll(() => {
        process.env = backupEnv;
    });

    describe('SoC Discretization & Node Limits', () => {
        test('should propagate ALGO_MAX_NODES from environment', async () => {
            process.env.ALGO_MAX_NODES = '5000000';
            calculateRouteGrpc.mockResolvedValue({ results: [] });

            await request(app)
                .post('/api/routes/calculate')
                .send({
                    start: { lat: 0, lng: 0 },
                    end: { lat: 1, lng: 1 }
                });

            expect(calculateRouteGrpc).toHaveBeenCalledWith(expect.objectContaining({
                maxNodes: 5000000
            }));
        });

        test('should use default maxNodes (10M) if env var is missing', async () => {
            calculateRouteGrpc.mockResolvedValue({ results: [] });

            await request(app)
                .post('/api/routes/calculate')
                .send({
                    start: { lat: 0, lng: 0 },
                    end: { lat: 1, lng: 1 }
                });

            expect(calculateRouteGrpc).toHaveBeenCalledWith(expect.objectContaining({
                maxNodes: 10000000
            }));
        });
    });

    describe('C++ Native Watchdog & Logging', () => {
        test('should propagate ALGO_KILL_TIME_MS from environment', async () => {
            process.env.ALGO_KILL_TIME_MS = '30000';
            calculateRouteGrpc.mockResolvedValue({ results: [] });

            await request(app)
                .post('/api/routes/calculate')
                .send({
                    start: { lat: 0, lng: 0 },
                    end: { lat: 1, lng: 1 }
                });

            expect(calculateRouteGrpc).toHaveBeenCalledWith(expect.objectContaining({
                killTimeMs: 30000
            }));
        });

        test('should use default 60,000ms kill limit if env var is missing (v2.3.0 Sync)', async () => {
            calculateRouteGrpc.mockResolvedValue({ results: [] });

            await request(app)
                .post('/api/routes/calculate')
                .send({
                    start: { lat: 0, lng: 0 },
                    end: { lat: 1, lng: 1 }
                });

            expect(calculateRouteGrpc).toHaveBeenCalledWith(expect.objectContaining({
                killTimeMs: 60000
            }));
        });

        test('should propagate ALGO_DEBUG_NODE_INTERVAL from environment', async () => {
            process.env.ALGO_DEBUG_NODE_INTERVAL = '1000';
            calculateRouteGrpc.mockResolvedValue({ results: [] });

            await request(app)
                .post('/api/routes/calculate')
                .send({
                    start: { lat: 0, lng: 0 },
                    end: { lat: 1, lng: 1 }
                });

            expect(calculateRouteGrpc).toHaveBeenCalledWith(expect.objectContaining({
                debugNodeInterval: 1000
            }));
        });

        test('should use default 5000 interval if env var is missing', async () => {
            calculateRouteGrpc.mockResolvedValue({ results: [] });

            await request(app)
                .post('/api/routes/calculate')
                .send({
                    start: { lat: 0, lng: 0 },
                    end: { lat: 1, lng: 1 }
                });

            expect(calculateRouteGrpc).toHaveBeenCalledWith(expect.objectContaining({
                debugNodeInterval: 5000
            }));
        });
    });

    describe('Algo Debug Decoupling', () => {
        test('should propagate ALGO_DEBUG=true to gRPC call', async () => {
            process.env.ALGO_DEBUG = 'true';
            calculateRouteGrpc.mockResolvedValue({ results: [] });

            await request(app)
                .post('/api/routes/calculate')
                .send({
                    start: { lat: 0, lng: 0 },
                    end: { lat: 1, lng: 1 }
                });

            expect(calculateRouteGrpc).toHaveBeenCalledWith(expect.objectContaining({
                algoDebug: true
            }));
        });

        test('should NOT trigger algoDebug when only DEBUG=true is set (Strict Decoupling)', async () => {
            process.env.DEBUG = 'true';
            calculateRouteGrpc.mockResolvedValue({ results: [] });

            await request(app)
                .post('/api/routes/calculate')
                .send({
                    start: { lat: 0, lng: 0 },
                    end: { lat: 1, lng: 1 }
                });

            expect(calculateRouteGrpc).toHaveBeenCalledWith(expect.objectContaining({
                algoDebug: false
            }));
        });
    });
});
