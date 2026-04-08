const mongoose = require('mongoose');
const mongoClient = require('./mongoClient');
const OcmTile = require('../models/OcmTile');
const OcmCharger = require('../models/OcmCharger');
const logger = require('../utils/logger');

/**
 * @fileoverview Service for managing OCM charger data and spatial tiles.
 * 
 * RESPONSIBILITIES:
 * 1. Provide atomicity for tile data ingestion using bulkWrite.
 * 2. Implement optimistic locking for tile fetching via status updates.
 * 3. Enforce the Self-Healing Lock Protocol (5-min TTL & forced reset).
 * 4. Maintain trace synchronization with [CALL] and [DONE] blocks.
 * 5. Ensure active database connection before every operation.
 */

// Staleness Constants (Hours)
const TILE_STALENESS_HOURS = 72;
const STATUS_STALENESS_HOURS = 24;

/**
 * Private helper to ensure an active Mongoose connection exists.
 * Prevents 10s buffering timeouts during "Cold Starts".
 * 
 * @async
 * @private
 * @returns {Promise<void>}
 */
const _ensureConnection = async () => {
    logger.call('_ensureConnection', `readyState: ${mongoose.connection.readyState}`);
    if (mongoose.connection.readyState !== 1) {
        await mongoClient.connectMongo();
    }
    logger.done('_ensureConnection', 'CONNECTED');
};

/**
 * Retrieves metadata for a specific spatial tile.
 * 
 * @async
 * @param {string} tile_key - The unique identifier for the tile.
 * @returns {Promise<Object|null>} The tile metadata or null if not found.
 */
const getTileMetadata = async (tile_key) => {
    await _ensureConnection();
    logger.call('getTileMetadata', `tile_key: ${tile_key}`);
    try {
        const tile = await OcmTile.findOne({ tile_key }).lean();
        logger.done('getTileMetadata', tile ? `found: ${tile_key}` : 'not found');
        return tile;
    } catch (err) {
        logger.error(`getTileMetadata failed | tile_key: ${tile_key} | error: ${err.message}`);
        throw err;
    }
};

/**
 * Retrieves all chargers associated with a specific spatial tile.
 * 
 * @async
 * @param {string} tile_key - The unique identifier for the tile.
 * @returns {Promise<Array>} List of chargers for the tile.
 */
const getChargersByTile = async (tile_key) => {
    await _ensureConnection();
    logger.call('getChargersByTile', `tile_key: ${tile_key}`);
    try {
        const chargers = await OcmCharger.find({ tile_key }).lean();
        logger.done('getChargersByTile', `count: ${chargers.length}`);
        return chargers;
    } catch (err) {
        logger.error(`getChargersByTile failed | tile_key: ${tile_key} | error: ${err.message}`);
        throw err;
    }
};

/**
 * Atomically upserts chargers for a tile and updates tile metadata.
 * 
 * WORKFLOW:
 * 1. Preparations: Map input chargers to Mongoose updateOne operations.
 * 2. Bulk Write: Execute all charger updates in one atomic-ish request to MongoDB.
 * 3. Metadata Sync: Update the tile's count, timestamp, and reset status to 'idle'.
 * 
 * @async
 * @param {string} tile_key - Unique tile identifier.
 * @param {Array} chargers - Array of charger objects (matching OcmCharger schema).
 * @param {Object} tileBbox - Bounding box [minLat, minLng, maxLat, maxLng].
 * @returns {Promise<void>}
 */
const upsertTileChargers = async (tile_key, chargers, tileBbox) => {
    await _ensureConnection();
    logger.call('upsertTileChargers', `tile_key: ${tile_key}, count: ${chargers.length}`);
    try {
        // Step 1: Prepare Bulk Operations for chargers
        const ops = chargers.map(c => ({
            updateOne: {
                filter: { ocm_id: c.ocm_id },
                update: {
                    $set: {
                        tile_key,
                        name: c.name,
                        lat: c.lat,
                        lng: c.lng,
                        location: {
                            type: 'Point',
                            coordinates: [c.lng, c.lat] // GeoJSON: [lng, lat]
                        },
                        available_ports: c.available_ports || [],
                        kw_output: c.kw_output || 0,
                        is_operational: c.is_operational ?? true,
                        status_refreshed_at: new Date()
                    }
                },
                upsert: true
            }
        }));

        if (ops.length > 0) {
            await OcmCharger.bulkWrite(ops);
        }

        // Step 2: Update Tile Metadata (only if tile_key is provided)
        if (tile_key) {
            await OcmTile.updateOne(
                { tile_key },
                {
                    $set: {
                        tile_key,
                        lat_min: tileBbox?.minLat,
                        lat_max: tileBbox?.maxLat,
                        lng_min: tileBbox?.minLng,
                        lng_max: tileBbox?.maxLng,
                        tile_fetched_at: new Date(),
                        charger_count: chargers.length,
                        fetch_status: 'idle'
                    }
                },
                { upsert: true }
            );
        }

        logger.done('upsertTileChargers', `tile_key: ${tile_key || 'null'} | SUCCESS`);
    } catch (err) {
        logger.error(`upsertTileChargers failed | tile_key: ${tile_key} | error: ${err.message}`);
        // Reset fetch status on failure to allow retries (only if tile_key is provided)
        if (tile_key) {
            await OcmTile.updateOne({ tile_key }, { $set: { fetch_status: 'failed' } }).catch(() => {});
        }
        throw err;
    }
};

// Lock Expiry (TTL) - 5 minutes
const LOCK_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Attempts to acquire an atomic lock for fetching a tile.
 * 
 * LOGIC:
 * - Uses updateOne with a conditional filter to ensure only 'idle' or 'failed' 
 *   tiles can be transitioned to 'fetching'.
 * - LOCK EXPIRY: Allows acquisition if status is 'fetching' but lock has 
 *   remained static for > 5 minutes (stalled worker recovery).
 * - Returns true if the lock was acquired, false otherwise.
 * 
 * @async
 * @param {string} tile_key - Tile to lock.
 * @returns {Promise<boolean>} Success status.
 */
const acquireTileFetchLock = async (tile_key) => {
    await _ensureConnection();
    logger.call('acquireTileFetchLock', `tile_key: ${tile_key}`);
    try {
        // Ensure the tile document exists first (idempotent upsert to idle if not exists)
        await OcmTile.updateOne(
            { tile_key },
            { $setOnInsert: { fetch_status: 'idle' } },
            { upsert: true }
        );

        const lockExpiryThreshold = new Date(Date.now() - LOCK_EXPIRY_MS);

        // Atomic transition from NOT fetching OR Expired fetching to fetching
        const result = await OcmTile.updateOne(
            { 
                tile_key,
                $or: [
                    { fetch_status: { $ne: 'fetching' } },
                    { fetch_status: 'fetching', updatedAt: { $lt: lockExpiryThreshold } }
                ]
            },
            { 
                $set: { 
                    fetch_status: 'fetching',
                    updatedAt: new Date() // Force fresh updatedAt to reset TTL window
                } 
            }
        );

        const acquired = result.modifiedCount > 0;
        logger.done('acquireTileFetchLock', `acquired: ${acquired}`);
        return acquired;
    } catch (err) {
        logger.error(`acquireTileFetchLock failed | tile_key: ${tile_key} | error: ${err.message}`);
        return false;
    }
};

module.exports = {
    getTileMetadata,
    getChargersByTile,
    upsertTileChargers,
    acquireTileFetchLock,
    TILE_STALENESS_HOURS,
    STATUS_STALENESS_HOURS
};
