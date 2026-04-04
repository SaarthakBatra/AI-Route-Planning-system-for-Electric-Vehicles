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
});
