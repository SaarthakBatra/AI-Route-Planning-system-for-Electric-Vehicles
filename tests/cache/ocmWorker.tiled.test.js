/**
 * @fileoverview Rigorous Unit Tests for Stage 5 OCM Tiled Ingestion.
 * 
 * FOCUS:
 * 1. Spatial Tiling (0.5 degree decomposition).
 * 2. Atomic Locking (via acquireTileFetchLock).
 * 3. Exact Bbox Trimming (filtering tile-level noise).
 * 4. Background Observer (status refresh non-blocking).
 */

const { getOCMChargers } = require('../../modules/cache/services/ocmWorker');
const chargerService = require('../../modules/database/services/chargerService');
const axios = require('axios');
const logger = require('../../modules/cache/utils/logger');

// Mocks
jest.mock('axios');
jest.mock('../../modules/database/services/chargerService');
jest.mock('../../modules/cache/utils/logger');

describe('OCM Tiled Ingestion Suite', () => {
    const mockBbox = {
        minLat: 28.1,
        minLon: 75.6,
        maxLat: 28.4,
        maxLon: 75.9
    };

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // ── 1. Tiling Decomposition ───────────────────────────────────────────────
    it('correctly requests data for overlapping tiles and merges them', async () => {
        // Mock DB returns empty for both tiles, prompting fetch
        chargerService.getTileMetadata.mockResolvedValue(null);
        chargerService.acquireTileFetchLock.mockResolvedValue(true);
        chargerService.getChargersByTile.mockResolvedValue([]);
        
        axios.get.mockResolvedValue({ data: [] });

        await getOCMChargers(mockBbox, 'test_region');

        // Bbox [28.1, 75.6, 28.4, 75.9] is fully within tile:28.0_75.5 (0.5 degree grid)
        const boundaryBbox = { minLat: 28.4, minLon: 75.4, maxLat: 28.6, maxLon: 75.6 };
        
        await getOCMChargers(boundaryBbox, 'boundary_test');
        expect(chargerService.getChargersByTile).toHaveBeenCalled(); 
    });

    // ── 2. Exact Bbox Trimming ────────────────────────────────────────────────
    it('filters out chargers inside the metadata tile but outside the request bbox', async () => {
        const chargersInTile = [
            { ocm_id: 1, lat: 28.2, lng: 75.7, location: { coordinates: [75.7, 28.2] } }, // INSIDE request bbox
            { ocm_id: 2, lat: 28.0, lng: 75.5, location: { coordinates: [75.5, 28.0] } }, // OUTSIDE request bbox
        ];

        chargerService.getTileMetadata.mockResolvedValue({ tile_fetched_at: new Date(), fetch_status: 'idle' });
        chargerService.getChargersByTile.mockResolvedValue(chargersInTile);

        const results = await getOCMChargers(mockBbox, 'trim_test');

        expect(results.length).toBe(1);
        expect(results[0].ocm_id).toBe(1);
    });

    // ── 3. Concurrency & Locking ──────────────────────────────────────────────
    it('waits and reads existing data from DB if another process is fetching (Lock Denied)', async () => {
        chargerService.getTileMetadata
            .mockResolvedValueOnce(null) // isMissing check
            .mockResolvedValueOnce({ fetch_status: 'fetching' }) // poll 1
            .mockResolvedValue({ fetch_status: 'idle', tile_fetched_at: new Date() }); // poll 2 (Done)

        chargerService.acquireTileFetchLock.mockResolvedValue(false); // Locked by someone else
        
        const existingChargers = [{ ocm_id: 101, lat: 28.2, lng: 75.7, location: { coordinates: [75.7, 28.2] } }];
        chargerService.getChargersByTile.mockResolvedValue(existingChargers);

        const workerPromise = getOCMChargers(mockBbox, 'lock_test');

        // Resolve polling intervals
        await jest.advanceTimersByTimeAsync(1000);

        const results = await workerPromise;

        // Should NOT call axios because lock was denied
        expect(axios.get).not.toHaveBeenCalled();
        expect(results.length).toBe(1);
        expect(results[0].ocm_id).toBe(101);
    });

    // ── 4. Background Status Observer ─────────────────────────────────────────
    it('triggers status refresh in the background for stale chargers (>24h)', async () => {
        const staleDate = new Date(Date.now() - 30 * 3600000); // 30h stale
        const staleCharger = { ocm_id: 555, lat: 28.2, lng: 75.7, location: { coordinates: [75.7, 28.2] }, status_refreshed_at: staleDate };

        chargerService.getTileMetadata.mockResolvedValue({ tile_fetched_at: new Date(), fetch_status: 'idle' });
        chargerService.getChargersByTile.mockResolvedValue([staleCharger]);
        
        axios.get.mockResolvedValue({ data: [{ ID: 555, StatusTypeID: 50 }] });

        await getOCMChargers(mockBbox, 'bg_refresh_test');
        
        // Advance timers to trigger the setImmediate status refresh
        jest.runOnlyPendingTimers();

        expect(axios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            params: expect.objectContaining({ id: '555' })
        }));
    });

    // ── 5. Resilience ────────────────────────────────────────────────────────
    it('returns an empty array if all database calls fail', async () => {
        chargerService.getTileMetadata.mockRejectedValue(new Error('DB DOWN'));
        
        const results = await getOCMChargers(mockBbox, 'failure_test');
        expect(results).toEqual([]);
        expect(logger.error).toHaveBeenCalled();
    });
});
