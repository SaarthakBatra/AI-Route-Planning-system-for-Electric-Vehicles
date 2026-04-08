/**
 * @fileoverview SRTM 3D Topography Service.
 * Implements local .hgt parsing and bilinear interpolation for high-fidelity elevation processing.
 */

const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');

const TILE_DIR = process.env.SRTM_TILE_DIR || './data/srtm';

/**
 * Maps a lat/lng to an SRTM filename (e.g., 28.5, 77.2 -> N28E077.hgt).
 */
const getTileName = (lat, lng) => {
    const latPrefix = lat >= 0 ? 'N' : 'S';
    const lngPrefix = lng >= 0 ? 'E' : 'W';
    const latAbs = Math.floor(Math.abs(lat)).toString().padStart(2, '0');
    const lngAbs = Math.floor(Math.abs(lng)).toString().padStart(3, '0');
    return `${latPrefix}${latAbs}${lngPrefix}${lngAbs}.hgt`;
};

/**
 * Loads a tile and performs bilinear interpolation.
 * @param {number} lat 
 * @param {number} lng 
 * @returns {Promise<{ elevation: number, confidence: number }>}
 */
const getElevation = async (lat, lng) => {
    const fileName = getTileName(lat, lng);
    const filePath = path.join(TILE_DIR, fileName);

    try {
        if (!(await fs.pathExists(filePath))) {
            return { elevation: 0, confidence: 0 };
        }

        const stats = await fs.stat(filePath);
        const size = stats.size;
        
        // Detect SRTM1 (1-arcsec, 3601x3601) or SRTM3 (3-arcsec, 1201x1201)
        // SRTM1 = 3601 * 3601 * 2 bytes = 25,934,402 bytes
        // SRTM3 = 1201 * 1201 * 2 bytes = 2,884,802 bytes
        const resolution = size > 3000000 ? 3601 : 1201;
        const buffer = await fs.readFile(filePath);

        // Relative position within the 1-degree tile [0, 1]
        const latRef = lat - Math.floor(lat);
        const lngRef = lng - Math.floor(lng);

        // Convert to grid coordinates (reversing lat because 0 is North)
        const x = lngRef * (resolution - 1);
        const y = (1 - latRef) * (resolution - 1);

        const x0 = Math.floor(x);
        const x1 = Math.min(x0 + 1, resolution - 1);
        const y0 = Math.floor(y);
        const y1 = Math.min(y0 + 1, resolution - 1);

        // Function to read raw value (16-bit Big-Endian signed)
        const readVal = (gx, gy) => {
            const offset = (gy * resolution + gx) * 2;
            const val = buffer.readInt16BE(offset);
            return val === -32768 ? 0 : val; // Handle "Void" as 0
        };

        const v00 = readVal(x0, y0);
        const v10 = readVal(x1, y0);
        const v01 = readVal(x0, y1);
        const v11 = readVal(x1, y1);

        // Bilinear Interpolation
        const fx = x - x0;
        const fy = y - y0;

        const elevation = v00 * (1 - fx) * (1 - fy) +
                         v10 * fx * (1 - fy) +
                         v01 * (1 - fx) * fy +
                         v11 * fx * fy;

        return {
            elevation: parseFloat(elevation.toFixed(2)),
            confidence: 1.0
        };

    } catch (err) {
        logger.error(`elevationService: Failed to read tile ${fileName} | ${err.message}`);
        return { elevation: 0, confidence: 0 };
    }
};

module.exports = {
    getElevation
};
