/**
 * @fileoverview Spatial tiling utility for Stage 5 route planning.
 * 
 * DESIGN PRINCIPLES:
 * 1. Fixed Grid: Uses 0.5° x 0.5° cells for global indexing.
 * 2. Stable Keys: Ensures consistent string formatting for MongoDB lookups.
 * 3. Atomic Tiling: Provides bounding box decomposition into unique tile keys.
 */

/**
 * Generates a stable tile key for a given coordinate.
 * 
 * Logic:
 * - Divide coordinate by 0.5 (grid size).
 * - Floor the result to get the cell index.
 * - Multiply back by 0.5 to get the cell start coordinate.
 * - Format to 1 decimal place to ensure string stability (e.g., "28.0" vs "28").
 * 
 * @param {number} lat - Latitude.
 * @param {number} lng - Longitude.
 * @returns {string} Tile key in format "tile:LAT_LNG".
 */
const getTileKey = (lat, lng) => {
    const latFloor = (Math.floor(lat / 0.5) * 0.5).toFixed(1);
    const lngFloor = (Math.floor(lng / 0.5) * 0.5).toFixed(1);
    return `tile:${latFloor}_${lngFloor}`;
};

/**
 * Returns an array of unique tile keys overlapping a bounding box.
 * 
 * @param {Object} bbox - Bounding box.
 * @param {number} bbox.minLat - Minimum latitude.
 * @param {number} bbox.minLng - Minimum longitude.
 * @param {number} bbox.maxLat - Maximum latitude.
 * @param {number} bbox.maxLng - Maximum longitude.
 * @returns {string[]} Array of unique tile keys.
 */
const getTileKeysForBbox = (bbox) => {
    const { minLat, minLng, maxLat, maxLng } = bbox;
    const keys = new Set();

    // Iterate through the grid in 0.5 degree increments
    // We add a small epsilon to the limit to ensure we cover the edge case of exactly on the boundary
    for (let lat = Math.floor(minLat / 0.5) * 0.5; lat <= maxLat; lat += 0.5) {
        for (let lng = Math.floor(minLng / 0.5) * 0.5; lng <= maxLng; lng += 0.5) {
            keys.add(getTileKey(lat, lng));
        }
    }

    return Array.from(keys);
};

module.exports = {
    getTileKey,
    getTileKeysForBbox,
};
