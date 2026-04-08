/**
 * @fileoverview Unit tests for modules/database/utils/tileKey.js
 */

const { getTileKey, getTileKeysForBbox } = require('../../modules/database/utils/tileKey');

describe('Database: tileKey.js', () => {
    describe('getTileKey()', () => {
        it('calculates correct key for positive coordinates', () => {
            expect(getTileKey(28.2, 75.8)).toBe('tile:28.0_75.5');
            expect(getTileKey(28.7, 75.2)).toBe('tile:28.5_75.0');
        });

        it('calculates correct key for negative coordinates', () => {
            expect(getTileKey(-1.2, -1.8)).toBe('tile:-1.5_-2.0');
            expect(getTileKey(-0.1, -0.4)).toBe('tile:-0.5_-0.5');
        });

        it('handles boundary cases exactly on 0.5 grid', () => {
            expect(getTileKey(28.0, 75.5)).toBe('tile:28.0_75.5');
            expect(getTileKey(28.5, 75.0)).toBe('tile:28.5_75.0');
        });

        it('ensures stable string formatting (.0)', () => {
            expect(getTileKey(28, 75)).toBe('tile:28.0_75.0');
        });
    });

    describe('getTileKeysForBbox()', () => {
        it('returns a single key for a very small bbox within one tile', () => {
            const bbox = { minLat: 28.1, minLng: 75.6, maxLat: 28.2, maxLng: 75.7 };
            const keys = getTileKeysForBbox(bbox);
            expect(keys).toEqual(['tile:28.0_75.5']);
        });

        it('returns multiple keys for a bbox crossing boundaries', () => {
            // Crosses from 28.0_75.5 to 28.5_75.5 and 28.0_76.0 and 28.5_76.0
            const bbox = { minLat: 28.4, minLng: 75.9, maxLat: 28.6, maxLng: 76.1 };
            const keys = getTileKeysForBbox(bbox);
            
            expect(keys).toContain('tile:28.0_75.5');
            expect(keys).toContain('tile:28.5_75.5');
            expect(keys).toContain('tile:28.0_76.0');
            expect(keys).toContain('tile:28.5_76.0');
            expect(keys.length).toBe(4);
        });

        it('handles negative coordinate bboxes', () => {
            const bbox = { minLat: -1.3, minLng: -1.9, maxLat: -1.1, maxLng: -1.7 };
            const keys = getTileKeysForBbox(bbox);
            expect(keys).toEqual(['tile:-1.5_-2.0']);
        });
    });
});
