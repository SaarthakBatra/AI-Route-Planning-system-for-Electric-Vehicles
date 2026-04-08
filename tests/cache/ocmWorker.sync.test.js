/**
 * @fileoverview Specialized test suite for Synchronous Ingestion and Concurrency.
 * Verifies that Request B correctly waits for Request A when data is missing.
 */

const { getOCMChargers } = require('../../modules/cache/services/ocmWorker');
const chargerService = require('../../modules/database/services/chargerService');
const axios = require('axios');
const logger = require('../../modules/cache/utils/logger');

// Mock dependencies
jest.mock('../../modules/database/services/chargerService');
jest.mock('axios');
jest.mock('../../modules/cache/utils/logger');

describe('OCM Worker: Synchronous Ingestion & Race Conditions', () => {
    const dummyBbox = { minLat: 51.5, minLon: -0.1, maxLat: 51.501, maxLon: -0.091 };
    const tileKey = 'tile:51.5_-0.5';

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('Primary Fetcher: Awaits OCM API and Persists Data', async () => {
        // Setup: Missing data, acquire lock success
        chargerService.getTileMetadata.mockResolvedValue(null);
        chargerService.acquireTileFetchLock.mockResolvedValue(true);
        axios.get.mockResolvedValue({ data: [{ ID: 1, AddressInfo: { Title: 'Test', Latitude: 51.5, Longitude: -0.1 } }] });
        chargerService.upsertTileChargers.mockResolvedValue({ success: true });
        chargerService.getChargersByTile.mockResolvedValue([{ 
            ocm_id: 1, 
            lat: 51.5, 
            lng: -0.1,
            location: { coordinates: [-0.1, 51.5] } 
        }]);

        const promise = getOCMChargers(dummyBbox, 'test_region');
        await promise;

        expect(chargerService.acquireTileFetchLock).toHaveBeenCalledWith(tileKey);
        expect(axios.get).toHaveBeenCalled();
        expect(chargerService.upsertTileChargers).toHaveBeenCalled();
        expect(chargerService.getChargersByTile).toHaveBeenCalledWith(tileKey);
    });

    test('Secondary Fetcher: Polls and Waits for Missing Data', async () => {
        // Setup: Missing data, lock denied (someone else fetching)
        chargerService.getTileMetadata
            .mockResolvedValueOnce(null) // isMissing check
            .mockResolvedValueOnce({ fetch_status: 'fetching' }) // poll 1
            .mockResolvedValueOnce({ fetch_status: 'fetching' }) // poll 2
            .mockResolvedValue({ fetch_status: 'idle', tile_fetched_at: new Date() }); // poll 3 (Done)

        chargerService.acquireTileFetchLock.mockResolvedValue(false);
        chargerService.getChargersByTile.mockResolvedValue([{ 
            ocm_id: 1, 
            lat: 51.5, 
            lng: -0.1,
            location: { coordinates: [-0.1, 51.5] }
        }]);

        const workerPromise = getOCMChargers(dummyBbox, 'test_region');

        // Resolve internal timer for 500ms intervals
        for (let i = 0; i < 3; i++) {
            await jest.advanceTimersByTimeAsync(500);
        }

        const result = await workerPromise;

        expect(chargerService.getTileMetadata).toHaveBeenCalledTimes(4); // 1 check + 3 polls
        expect(result.length).toBe(1);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Waiting for concurrent fetch'));
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Wait complete'));
    });

    test('Stale Data Fetcher: Returns Old Data Without Blocking', async () => {
        // Setup: Stale data (existing), lock denied (someone else refreshing)
        const oldDate = new Date(Date.now() - 80 * 3600000); // 80h old (>72h)
        chargerService.getTileMetadata.mockResolvedValue({ tile_fetched_at: oldDate, fetch_status: 'fetching' });
        chargerService.acquireTileFetchLock.mockResolvedValue(false);
        chargerService.getChargersByTile.mockResolvedValue([{ 
            ocm_id: 1, 
            lat: 51.5, 
            lng: -0.1,
            location: { coordinates: [-0.1, 51.5] }
        }]);

        const result = await getOCMChargers(dummyBbox, 'test_region');

        // Should return immediately without polling
        expect(chargerService.getTileMetadata).toHaveBeenCalledTimes(1);
        expect(result.length).toBe(1);
    });

    test('Wait Timeout: Aborts Polling After 10 Seconds', async () => {
        // Setup: Missing data, lock denied, remains 'fetching' forever
        chargerService.getTileMetadata.mockResolvedValue({ fetch_status: 'fetching' });
        chargerService.getTileMetadata.mockResolvedValueOnce(null); // initial check

        chargerService.acquireTileFetchLock.mockResolvedValue(false);
        chargerService.getChargersByTile.mockResolvedValue([]);

        const workerPromise = getOCMChargers(dummyBbox, 'test_region');

        // Fast-forward 25 cycles of 500ms = 12.5s (>10s)
        for (let i = 0; i < 25; i++) {
            await jest.advanceTimersByTimeAsync(500);
        }

        const result = await workerPromise;

        expect(result.length).toBe(0);
        expect(chargerService.getTileMetadata.mock.calls.length).toBeGreaterThan(15);
    });
});
