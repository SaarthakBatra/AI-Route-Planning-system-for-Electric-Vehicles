const mongoose = require('mongoose');

/**
 * @fileoverview Mongoose schema for Stage 5 OCM Chargers.
 * 
 * RESPONSIBILITIES:
 * 1. Store high-fidelity charger data with spatial indexing.
 * 2. Maintain status refreshed timestamps for individual chargers.
 * 3. Support complex geometry queries (2dsphere index).
 */

const ocmChargerSchema = new mongoose.Schema({
    /** Original ID from OpenChargeMap */
    ocm_id: {
        type: Number,
        required: true,
        unique: true,
        index: true,
    },

    /** Reference key for the 0.5 degree spatial tile */
    tile_key: {
        type: String,
        required: true,
        index: true,
    },

    /** Human-readable name/location of the charger */
    name: { type: String, required: true },

    /** Flat coordinates (Legacy/Reference) */
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },

    /** GeoJSON location for 2dsphere queries */
    location: {
        type: {
            type: String,
            enum: ['Point'],
            required: true,
            default: 'Point',
        },
        coordinates: {
            type: [Number],
            required: true,
        },
    },

    /** Array of available port types/counts */
    available_ports: [{
        type: String, // e.g., 'Type2', 'CCS2'
    }],

    /** Power output in Kilowatts */
    kw_output: { type: Number, default: 0 },

    /** Operational status */
    is_operational: { type: Boolean, default: true },

    /** Timestamp of last individual status refresh */
    status_refreshed_at: {
        type: Date,
        default: Date.now,
    },
}, {
    timestamps: true,
});

// CRITICAL: 2dsphere index for spatial queries
ocmChargerSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('OcmCharger', ocmChargerSchema);
