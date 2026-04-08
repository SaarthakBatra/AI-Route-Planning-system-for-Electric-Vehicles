/**
 * @fileoverview Unit tests for modules/database/services/chargerService.js
 * 
 * Strategy:
 * 1. Mock Mongoose models and logger.
 * 2. Mock Mongoose connection and mongoClient to test the _ensureConnection guard.
 * 3. Verify that every public method triggers the guard.
 */

const mongoose = require('mongoose');
const mongoClient = require('../../modules/database/services/mongoClient');
const OcmTile = require('../../modules/database/models/OcmTile');
const OcmCharger = require('../../modules/database/models/OcmCharger');
const logger = require('../../modules/database/utils/logger');
const chargerService = require('../../modules/database/services/chargerService');

// Mock Dependencies
jest.mock('mongoose', () => {
    const actualMongoose = jest.requireActual('mongoose');
    return {
        Schema: actualMongoose.Schema,
        model: actualMongoose.model,
        connection: {
            readyState: 1, // Default to connected
            on: jest.fn(), // Required by mongoClient.js listeners
            host: 'mock-host'
        },
    };
});
jest.mock('../../modules/database/services/mongoClient');
jest.mock('../../modules/database/models/OcmTile');
jest.mock('../../modules/database/models/OcmCharger');
jest.mock('../../modules/database/utils/logger');

describe('Database: chargerService.js', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset mongoose connection state to connected by default for legacy compatibility
        mongoose.connection.readyState = 1;

        // Default mock implementations to prevent "lean on undefined" and "catch on undefined" errors
        OcmTile.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
        OcmCharger.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
        OcmTile.updateOne.mockReturnValue(Promise.resolve({ modifiedCount: 0 }));
        OcmCharger.bulkWrite.mockResolvedValue({}); // Default to success
    });

    // ─── New Suite: Connection Guard Logic ───────────────────────────────────
    describe('_ensureConnection Guard', () => {
        it('triggers mongoClient.connectMongo() when readyState is 0 (Disconnected)', async () => {
            mongoose.connection.readyState = 0;
            mongoClient.connectMongo.mockResolvedValue(1);
            
            // Calling any public method should trigger the guard
            await chargerService.getTileMetadata('tile:test');

            expect(mongoClient.connectMongo).toHaveBeenCalledTimes(1);
            expect(logger.call).toHaveBeenCalledWith('_ensureConnection', expect.stringContaining('readyState: 0'));
            expect(logger.done).toHaveBeenCalledWith('_ensureConnection', 'CONNECTED');
        });

        it('bypasses mongoClient.connectMongo() when readyState is 1 (Connected)', async () => {
            mongoose.connection.readyState = 1;
            
            await chargerService.getTileMetadata('tile:test');

            expect(mongoClient.connectMongo).not.toHaveBeenCalled();
            expect(logger.done).toHaveBeenCalledWith('_ensureConnection', 'CONNECTED');
        });
    });

    // ─── Legacy Testing Suite (Backwards Compatible) ──────────────────────────
    describe('getTileMetadata()', () => {
        it('returns tile if found', async () => {
            const mockTile = { tile_key: 'tile:28.0_75.5', charger_count: 5 };
            OcmTile.findOne.mockReturnValue({
                lean: jest.fn().mockResolvedValue(mockTile)
            });

            const result = await chargerService.getTileMetadata('tile:28.0_75.5');
            expect(result).toEqual(mockTile);
            expect(logger.call).toHaveBeenCalledWith('getTileMetadata', expect.any(String));
            expect(logger.done).toHaveBeenCalledWith('getTileMetadata', expect.stringContaining('found'));
        });

        it('returns null if not found', async () => {
            OcmTile.findOne.mockReturnValue({
                lean: jest.fn().mockResolvedValue(null)
            });

            const result = await chargerService.getTileMetadata('tile:0.0_0.0');
            expect(result).toBeNull();
            expect(logger.done).toHaveBeenCalledWith('getTileMetadata', 'not found');
        });
    });

    describe('getChargersByTile()', () => {
        it('returns array of chargers', async () => {
            const mockChargers = [{ ocm_id: 1, name: 'C1' }, { ocm_id: 2, name: 'C2' }];
            OcmCharger.find.mockReturnValue({
                lean: jest.fn().mockResolvedValue(mockChargers)
            });

            const result = await chargerService.getChargersByTile('tile:28.0_75.5');
            expect(result).toEqual(mockChargers);
            expect(result.length).toBe(2);
        });
    });

    describe('upsertTileChargers()', () => {
        it('executes bulkWrite and updates tile metadata (Standard case)', async () => {
            const tile_key = 'tile:28.0_75.5';
            const chargers = [{ ocm_id: 101, name: 'FastCharge', lat: 28.1, lng: 75.6 }];
            const tileBbox = { minLat: 28.0, maxLat: 28.5, minLng: 75.5, maxLng: 76.0 };

            await chargerService.upsertTileChargers(tile_key, chargers, tileBbox);

            expect(OcmCharger.bulkWrite).toHaveBeenCalledTimes(1);
            expect(OcmTile.updateOne).toHaveBeenCalledWith(
                { tile_key },
                expect.objectContaining({
                    $set: expect.objectContaining({
                        charger_count: 1,
                        fetch_status: 'idle'
                    })
                }),
                { upsert: true }
            );
        });

        it('skips tile metadata update if tile_key is null/undefined (Single-charger case)', async () => {
            const chargers = [{ ocm_id: 101, name: 'FastCharge' }];
            
            await chargerService.upsertTileChargers(null, chargers, null);

            expect(OcmCharger.bulkWrite).toHaveBeenCalledTimes(1);
            expect(OcmTile.updateOne).not.toHaveBeenCalled();
            expect(logger.done).toHaveBeenCalledWith('upsertTileChargers', 'tile_key: null | SUCCESS');
        });

        it('resets fetch_status to "failed" on catch block if tile_key exists', async () => {
            const tile_key = 'tile:fail';
            const chargers = [{ ocm_id: 666, name: 'Broken' }]; // At least one charger to trigger bulkWrite
            OcmCharger.bulkWrite.mockRejectedValueOnce(new Error('DB Error'));

            await expect(chargerService.upsertTileChargers(tile_key, chargers, {}))
                .rejects.toThrow('DB Error');

            expect(OcmTile.updateOne).toHaveBeenCalledWith(
                { tile_key },
                { $set: { fetch_status: 'failed' } }
            );
        });
    });

    describe('acquireTileFetchLock()', () => {
        it('returns true when lock is successfully modified (Idle case)', async () => {
            OcmTile.updateOne.mockResolvedValueOnce({ modifiedCount: 0 }); // for upsert
            OcmTile.updateOne.mockResolvedValueOnce({ modifiedCount: 1 }); // for lock acquisition

            const result = await chargerService.acquireTileFetchLock('tile:28.0_75.5');
            expect(result).toBe(true);
            
            // Verify query uses $or for TTL logic
            const lockCall = OcmTile.updateOne.mock.calls[1][0];
            expect(lockCall).toHaveProperty('$or');
            expect(lockCall.$or).toContainEqual({ fetch_status: { $ne: 'fetching' } });
        });

        it('returns true if fetch_status is "fetching" but lock has expired (> 5 mins)', async () => {
            OcmTile.updateOne.mockResolvedValueOnce({ modifiedCount: 0 }); // for upsert
            OcmTile.updateOne.mockResolvedValueOnce({ modifiedCount: 1 }); // successfully re-acquired

            const result = await chargerService.acquireTileFetchLock('tile:28.0_75.5');
            expect(result).toBe(true);
        });

        it('returns false if fetch_status is "fetching" and lock is fresh (< 5 mins)', async () => {
            OcmTile.updateOne.mockResolvedValueOnce({ modifiedCount: 0 }); // for upsert
            OcmTile.updateOne.mockResolvedValueOnce({ modifiedCount: 0 }); // failed to acquire (fresh)

            const result = await chargerService.acquireTileFetchLock('tile:28.0_75.5');
            expect(result).toBe(false);
        });
    });

    // ─── New Suite: Self-Healing Lock Protocol ───────────────────────────────
    describe('Self-Healing Lock Protocol', () => {
        const tile_key = 'tile:self-healing';
        const chargers = [{ ocm_id: 99, name: 'HealingStation' }];
        const tileBbox = { minLat: 10, maxLat: 11, minLng: 20, maxLng: 21 };

        it('Temporal Recovery: Re-acquires lock if updatedAt is older than 5 mins', async () => {
            // Mock initial upsert to 'idle'
            OcmTile.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
            // Mock successful re-acquisition of 'fetching' status
            OcmTile.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });

            const result = await chargerService.acquireTileFetchLock(tile_key);
            expect(result).toBe(true);
            
            // Verify query logic includes expired fetching status
            const query = OcmTile.updateOne.mock.calls[1][0];
            expect(query.$or).toContainEqual({ 
                fetch_status: 'fetching', 
                updatedAt: { $lt: expect.any(Date) } 
            });
        });

        it('State Convergence: upsertTileChargers forcibly resets status to "idle"', async () => {
            await chargerService.upsertTileChargers(tile_key, chargers, tileBbox);

            expect(OcmTile.updateOne).toHaveBeenCalledWith(
                { tile_key },
                expect.objectContaining({
                    $set: expect.objectContaining({
                        fetch_status: 'idle',
                        charger_count: 1,
                        tile_fetched_at: expect.any(Date)
                    })
                }),
                { upsert: true }
            );
        });

        it('Atomic Metrics: charger_count is synchronized with input array length', async () => {
            const multipleChargers = [
                { ocm_id: 1, name: 'S1' },
                { ocm_id: 2, name: 'S2' }
            ];
            await chargerService.upsertTileChargers(tile_key, multipleChargers, tileBbox);

            expect(OcmTile.updateOne).toHaveBeenCalledWith(
                { tile_key },
                expect.objectContaining({
                    $set: expect.objectContaining({
                        charger_count: 2
                    })
                }),
                { upsert: true }
            );
        });
    });
});
