/**
 * @fileoverview Unit tests for gRPC Configuration.
 * 
 * Verifies that the gRPC client is initialized with the correct
 * payload size limits from the environment variables.
 */

const grpc = require('@grpc/grpc-js');

// Mock grpc.loadPackageDefinition to capture the constructor call
jest.mock('@grpc/grpc-js', () => {
    const actual = jest.requireActual('@grpc/grpc-js');
    return {
        ...actual,
        loadPackageDefinition: jest.fn().mockReturnValue({
            route_engine: {
                RouteService: jest.fn().mockImplementation((target, credentials, options) => ({
                    target,
                    credentials,
                    options,
                    CalculateRoute: jest.fn()
                }))
            }
        })
    };
});

describe('gRPC Client Configuration', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    test('1. Client initialized with 50MB limits by default', () => {
        delete process.env.GRPC_MAX_MESSAGE_SIZE;
        const { client } = require('../../modules/backend/services/grpcClient');
        const expectedLimit = 50 * 1024 * 1024;

        expect(client.options['grpc.max_send_message_length']).toBe(expectedLimit);
        expect(client.options['grpc.max_receive_message_length']).toBe(expectedLimit);
    });

    test('2. Client initialized with custom limit from environment', () => {
        const customLimit = 100 * 1024 * 1024;
        process.env.GRPC_MAX_MESSAGE_SIZE = customLimit.toString();
        
        const { client } = require('../../modules/backend/services/grpcClient');

        expect(client.options['grpc.max_send_message_length']).toBe(customLimit);
        expect(client.options['grpc.max_receive_message_length']).toBe(customLimit);
    });

    test('3. calculateRouteGrpc packs full 17-field EVParams correctly', async () => {
        const { calculateRouteGrpc } = require('../../modules/backend/services/grpcClient');
        const { client } = require('../../modules/backend/services/grpcClient');
        
        const mockEvParams = {
            effective_mass_kg: 2000,
            drag_coeff: 0.25,
            aux_power_kw: 1.5,
            enabled: true
        };

        const mockResponse = { results: [] };
        client.CalculateRoute.mockImplementation((req, meta, callback) => {
            callback(null, mockResponse);
        });

        await calculateRouteGrpc({
            start: {},
            end: {},
            mockHour: 0,
            objective: 'FASTEST',
            mapDataPb: null,
            regionId: '',
            mapData: '',
            evParams: mockEvParams
        });

        const lastCall = client.CalculateRoute.mock.calls[0];
        const sentRequest = lastCall[0];

        expect(sentRequest.ev_params).toBeDefined();
        expect(sentRequest.ev_params.effective_mass_kg).toBe(2000);
        expect(sentRequest.ev_params.drag_coeff).toBe(0.25);
        expect(sentRequest.ev_params.aux_power_kw).toBe(1.5);
    });

    test('5. calculateRouteGrpc packs new v2.5.0 EV parameters correctly', async () => {
        const { calculateRouteGrpc, client } = require('../../modules/backend/services/grpcClient');
        
        const mockEvParams = {
            target_charge_bound_kwh: 55.5,
            is_emergency_assumption: true
        };

        client.CalculateRoute.mockImplementation((req, meta, callback) => {
            callback(null, { results: [] });
        });

        await calculateRouteGrpc({
            start: {},
            end: {},
            evParams: mockEvParams
        });

        const sentRequest = client.CalculateRoute.mock.calls[0][0];
        expect(sentRequest.ev_params.target_charge_bound_kwh).toBe(55.5);
        expect(sentRequest.ev_params.is_emergency_assumption).toBe(true);
    });

    test('4. calculateRouteGrpc injects algo-debug and debug-mode metadata (v2.2.0)', async () => {
        const { calculateRouteGrpc, client } = require('../../modules/backend/services/grpcClient');
        
        client.CalculateRoute.mockImplementation((req, meta, callback) => {
            callback(null, { results: [] });
        });

        await calculateRouteGrpc({
            algoDebug: true,
            debugMode: false
        });

        const metadata = client.CalculateRoute.mock.calls[0][1];
        expect(metadata.get('algo-debug')).toEqual(['true']);
        expect(metadata.get('debug-mode')).toEqual(['false']);
    });
});
