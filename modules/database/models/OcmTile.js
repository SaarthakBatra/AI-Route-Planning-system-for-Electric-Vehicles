const mongoose = require('mongoose');

/**
 * @fileoverview Mongoose schema for Stage 5 OCM Tiles.
 * 
 * RESPONSIBILITIES:
 * 1. Track lifecycle metadata for 0.5° spatial tiles.
 * 2. Manage fetch status (atomic locks) to prevent redundant OCM API calls.
 * 3. Store tile boundaries (lat/lng min/max) for spatial validation.
 */

const ocmTileSchema = new mongoose.Schema({
    /** Unique tile identifier (e.g., "tile:28.0_75.5") */
    tile_key: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    
    /** Bounding box for the 0.5 degree cell */
    lat_min: { type: Number, required: true },
    lat_max: { type: Number, required: true },
    lng_min: { type: Number, required: true },
    lng_max: { type: Number, required: true },

    /** Last full fetch from OCM API */
    tile_fetched_at: {
        type: Date,
        default: null,
    },

    /** Number of chargers currently stored for this tile */
    charger_count: {
        type: Number,
        default: 0,
    },

    /** Lifecycle status of the tile fetch operation */
    fetch_status: {
        type: String,
        enum: ['idle', 'fetching', 'failed'],
        default: 'idle',
    },
}, {
    timestamps: true,
});

module.exports = mongoose.model('OcmTile', ocmTileSchema);
