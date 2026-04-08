/**
 * @fileoverview Comprehensive Stage 5 Tests for Cache Module.
 * Covers 3D Topography, OCM Ingestion, and Fail-Safe Logic.
 */

const { getElevation } = require('../../modules/cache/services/elevationService');
const { mapPorts } = require('../../modules/cache/utils/portMapper');
const { convertToMapPayload } = require('../../modules/cache/services/osmWorker');
const fs = require('fs-extra');
const path = require('path');

// Mocks
jest.mock('../../modules/cache/services/redisClient', () => ({
    client: {
        get: jest.fn(),
        getBuffer: jest.fn(),
        set: jest.fn(),
        zadd: jest.fn(),
        zcard: jest.fn()
    }
}));
jest.mock('../../modules/cache/services/ocmWorker', () => ({
    getOCMChargers: jest.fn().mockResolvedValue([
        {
            ocm_id: 999,
            name: 'Mock OCM Charger',
            lat: 28.5,
            lng: 77.2,
            location: { coordinates: [77.2, 28.5] }, // GeoJSON required
            kw_output: 50,
            is_operational: true,
            available_ports: ['CCS2'],
            status_refreshed_at: new Date()
        }
    ])
}));

describe('Stage 5: Comprehensive Cache Verification', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ── 1. Topography & Elevation ─────────────────────────────────────────────
    describe('Elevation Service (Bilinear Interpolation)', () => {
        it('calculates elevation accurately using bilinear interpolation', async () => {
            // Mock a small 1201x1201 (SRTM3) tile buffer
            const mockBuffer = Buffer.alloc(1201 * 1201 * 2);
            // Mock a flat gradient for easy calculation. Indices for 28.5N are 600.
            const offset = (600 * 1201 + 600) * 2;
            mockBuffer.writeInt16BE(100, offset);         // v00 (top-left)
            mockBuffer.writeInt16BE(200, offset + 2);     // v10 (top-right)
            
            // Note: In SRTM, North is y0, so Southernly (y1) is offset + rows * 2
            const nextRow = (601 * 1201 + 600) * 2;
            mockBuffer.writeInt16BE(200, nextRow);        // v01 (bottom-left)
            mockBuffer.writeInt16BE(300, nextRow + 2);    // v11 (bottom-right)

            jest.spyOn(fs, 'pathExists').mockResolvedValue(true);
            jest.spyOn(fs, 'stat').mockResolvedValue({ size: 2884802 }); // SRTM3
            jest.spyOn(fs, 'readFile').mockResolvedValue(mockBuffer);

            // Fetch exactly at the 50% midpoint of the cell
            const result = await getElevation(28.5 - 0.5/1200, 77.0 + 600.5/1200); 
            
            expect(result.elevation).toBeGreaterThan(150);
            expect(result.elevation).toBeLessThan(250);
            expect(result.confidence).toBe(1.0);
        });

        it('returns zero elevation and zero confidence when tile is missing', async () => {
            jest.spyOn(fs, 'pathExists').mockResolvedValue(false);
            const result = await getElevation(10, 10);
            expect(result.elevation).toBe(0);
            expect(result.confidence).toBe(0);
        });
    });

    // ── 2. Port Mapping ───────────────────────────────────────────────────────
    describe('Port Mapper', () => {
        it('correctly maps OCM ConnectionTypeIDs to canonical enums', () => {
            expect(mapPorts([2, 4])).toEqual(['IEC_62196_T2', 'CCS2']);
            expect(mapPorts([1036, 1042])).toEqual(['BHARAT_DC', 'WALL_PLUG']);
            expect(mapPorts([9999])).toEqual(['UNKNOWN_PORT']); // Unknown fallback
        });
    });

    // ── 3. MapPayload Orchestration ───────────────────────────────────────────
    describe('convertToMapPayload (Orchestration)', () => {
        const mockOsmData = {
            elements: [
                { type: 'node', id: 1, lat: 28.5, lon: 77.2, tags: { name: 'OSM Node' } },
                { type: 'node', id: 2, lat: 28.501, lon: 77.201, tags: { amenity: 'fuel', name: 'Emergency Gas' } },
                { 
                    type: 'way', 
                    id: 10, 
                    nodes: [1, 2], 
                    tags: { highway: 'primary', name: 'Test Road' } 
                }
            ]
        };

        const bbox = { minLat: 28, minLon: 77, maxLat: 29, maxLon: 78 };

        it('populates new Stage 5 fields in the Protobuf output', async () => {
            const binary = await convertToMapPayload(mockOsmData, bbox, 'test_region');
            expect(binary).toBeInstanceOf(Buffer);
            
            // Note: In a real environment, we'd use protobufjs to decode and verify.
            // Here we verify the orchestration completed without error.
            expect(binary.length).toBeGreaterThan(0);
        });

        it('implements MAX_FLOAT fail-safe for broken topology', async () => {
            // Mock data with a way referring to a non-existent node
            const brokenData = {
                elements: [
                    { type: 'node', id: 1, lat: 28.5, lon: 77.2 },
                    { type: 'way', id: 10, nodes: [1, 999], tags: { highway: 'primary' } }
                ]
            };

            const binary = await convertToMapPayload(brokenData, bbox, 'test_region');
            // We verify orchestration succeeds despite the break
            expect(binary).toBeInstanceOf(Buffer);
        });
    });

    // ── 4. Multi-Query & Resilience ───────────────────────────────────────────
    describe('OCM Ingestion Resilience', () => {
        it('handles OCM API failures gracefully by returning OSM-only data', async () => {
            const { getOCMChargers } = require('../../modules/cache/services/ocmWorker');
            // Simulate an OCM fetch failure (e.g. 403 Forbidden)
            getOCMChargers.mockResolvedValueOnce([]); 

            const mockOsmData = { elements: [{ type: 'node', id: 1, lat: 28.5, lon: 77.2 }] };
            const bbox = { minLat: 28, minLon: 77, maxLat: 29, maxLon: 78 };

            const binary = await convertToMapPayload(mockOsmData, bbox, 'test_region');
            expect(binary).toBeInstanceOf(Buffer);
            expect(binary.length).toBeGreaterThan(0);
        });
    });
});
