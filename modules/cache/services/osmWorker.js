require('dotenv').config({ path: __dirname + '/../.env' });
const { client } = require('./redisClient');
const logger = require('../utils/logger');

/**
 * @fileoverview OSM API Worker for dynamic map ingestion and caching.
 *
 * Responsibilities:
 *  - Quantize coordinates (4 decimal places) for cache hitting.
 *  - Fetch street data from OSM Overpass API via native fetch.
 *  - Implement Custom LRU Eviction using a Redis Sorted Set (ZSET).
 *  - Prevent redundant concurrent fetches via Promise memoization.
 */

const MAX_CACHE_ENTRIES = parseInt(process.env.MAX_CACHE_ENTRIES, 10) || 1000;
const METADATA_KEY = 'osm_metadata';

// In-memory memoization to prevent concurrent fetches for the same bbox
const pendingFetches = new Map();

/**
 * Quantize a coordinate to 4 decimal places (~11m precision).
 * @param {number} val 
 * @returns {number}
 */
const quantize = (val) => parseFloat(Number(val).toFixed(4));

/**
 * Generates a consistent Redis key for a bounding box.
 * @param {Object} bbox - { minLat, minLon, maxLat, maxLon }
 * @returns {string}
 */
const getBBoxKey = (bbox) => {
    const minLat = quantize(bbox.minLat);
    const minLon = quantize(bbox.minLon);
    const maxLat = quantize(bbox.maxLat);
    const maxLon = quantize(bbox.maxLon);
    return `osm:data:${minLat}:${minLon}:${maxLat}:${maxLon}`;
};

/**
 * Fetches map data from OSM Overpass API.
 * Uses native fetch as per security requirements.
 * @param {Object} bbox
 */
const fetchMapData = async (bbox) => {
    const { minLat, minLon, maxLat, maxLon } = bbox;
    // Query fetches all highway ways and their associated nodes
    const query = `[out:json];(way["highway"](${minLat},${minLon},${maxLat},${maxLon}););out body;>;out skel qt;`;
    const url = 'https://overpass-api.de/api/interpreter';
    
    logger.info(`Fetching OSM data from Overpass | bbox: ${minLat},${minLon},${maxLat},${maxLon}`);
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            body: 'data=' + encodeURIComponent(query),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        if (!response.ok) {
            throw new Error(`OSM API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        logger.info(`OSM Data Received | elements: ${data.elements?.length || 0}`);
        return data;
    } catch (err) {
        logger.error(`OSM Fetch Failed | error: ${err.message}`);
        throw err;
    }
};

/**
 * Main orchestrator for getting map data (Cache-Aside + LRU).
 * 
 * Logic:
 * 1. Check Redis for Cached Data.
 * 2. On HIT: Update access timestamp in ZSET and return.
 * 3. On MISS: 
 *    - Check for pending fetches (Promise memoization).
 *    - Ingest from OSM Overpass API.
 *    - Store in Redis and update ZSET.
 *    - Perform LRU Eviction Check (remove oldest if count > MAX).
 * 
 * @param {Object} bbox - { minLat, minLon, maxLat, maxLon }
 * @returns {Promise<Object>} The OSM JSON data.
 */
const getMapData = async (bbox) => {
    const key = getBBoxKey(bbox);
    logger.call('getMapData', `key: ${key}`);

    try {
        // 1. Check Redis for Cached Data
        const cachedData = await client.get(key);
        if (cachedData) {
            logger.info(`Cache HIT | key: ${key}`);
            // Update access timestamp for LRU priority
            await client.zadd(METADATA_KEY, Date.now(), key);
            logger.done('getMapData', 'HIT');
            return JSON.parse(cachedData);
        }

        // 2. Cache MISS
        logger.info(`Cache MISS | key: ${key}`);
        
        // 3. Prevent Concurrent Re-Fetches
        if (pendingFetches.has(key)) {
            logger.info(`Attaching to pending fetch | key: ${key}`);
            return await pendingFetches.get(key);
        }

        // 4. Ingest and Cache
        const fetchPromise = (async () => {
            try {
                const data = await fetchMapData(bbox);
                
                // Store data
                await client.set(key, JSON.stringify(data));
                // Track metadata (access timestamp)
                await client.zadd(METADATA_KEY, Date.now(), key);
                
                // 5. LRU Eviction Check
                const count = await client.zcard(METADATA_KEY);
                if (count > MAX_CACHE_ENTRIES) {
                    const oldestKeys = await client.zrange(METADATA_KEY, 0, 0);
                    if (oldestKeys.length > 0) {
                        const oldestKey = oldestKeys[0];
                        logger.info(`Evicting oldest entry | key: ${oldestKey}`);
                        await client.del(oldestKey);
                        await client.zrem(METADATA_KEY, oldestKey);
                    }
                }

                return data;
            } finally {
                pendingFetches.delete(key);
            }
        })();

        pendingFetches.set(key, fetchPromise);
        const result = await fetchPromise;
        logger.done('getMapData', 'INGESTED');
        return result;

    } catch (err) {
        logger.error(`getMapData failed | error: ${err.message}`);
        throw err;
    }
};

module.exports = {
    getMapData,
    getBBoxKey,
    quantize
};
