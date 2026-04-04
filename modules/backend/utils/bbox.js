/**
 * @file bbox.js
 * @module backend/utils/bbox
 * @description Geographical utility for calculating search areas with buffering and 4-decimal precision quantization.
 */

/**
 * Calculates a bounding box from two coordinates with a buffer.
 * 
 * @param {Object} start - { lat, lng }
 * @param {Object} end - { lat, lng }
 * @param {number} buffer - Degree buffer to extend the box (default: 0.01)
 * @returns {Object} - { minLat, minLon, maxLat, maxLon }
 */
const calculateBBox = (start, end, buffer = 0.1) => {
    const minLat = parseFloat((Math.min(start.lat, end.lat) - buffer).toFixed(4));
    const maxLat = parseFloat((Math.max(start.lat, end.lat) + buffer).toFixed(4));
    const minLon = parseFloat((Math.min(start.lng, end.lng) - buffer).toFixed(4));
    const maxLon = parseFloat((Math.max(start.lng, end.lng) + buffer).toFixed(4));

    return {
        minLat,
        minLon,
        maxLat,
        maxLon
    };
};


module.exports = {
    calculateBBox
};
