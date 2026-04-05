/**
 * @fileoverview Geographic Distance Utility.
 *
 * Workflow:
 *  1. Angular Conversion: Translates Latitude and Longitude from degrees to radians.
 *  2. Haversine Formula Application: Calculates the great-circle distance between two 
 *     points on a sphere (Earth) with radius 6,371km (WGS-84 approximation).
 *  3. Quantization: Rounds the result to 2 decimal places (centimeter precision) 
 *     to ensure stable Protobuf weights.
 */

/**
 * Calculates the Haversine distance between two points on the Earth's surface.
 * @param {number} lat1 - Latitude of start point
 * @param {number} lon1 - Longitude of start point
 * @param {number} lat2 - Latitude of end point
 * @param {number} lon2 - Longitude of end point
 * @returns {number} Distance in meters rounded to 2 decimal places.
 */
const calculateHaversine = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Earth radius in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dPhi = ((lat2 - lat1) * Math.PI) / 180;
    const dLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return parseFloat(distance.toFixed(2));
};

module.exports = {
    calculateHaversine
};
