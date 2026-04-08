/**
 * @fileoverview OpenChargeMap (OCM) Worker with Synchronous Ingestion Protocol.
 * 
 * DESIGN PRINCIPLES:
 * 1. Tiled Ingestion: Decomposes requests into 0.5° cells for efficient global caching.
 * 2. Database Delegation: Zero direct Mongoose usage; all persistence via database module.
 * 3. Synchronous Ingestion: Guarantees high-fidelity maps on the first query by
 *    synchronizing concurrent fetch attempts for new/missing spatial tiles.
 * 4. Background Observations: Status updates are non-blocking to gRPC performance.
 */

const axios = require('axios');
const chargerService = require('../../database/services/chargerService');
const { getTileKeysForBbox } = require('../../database/utils/tileKey');
const { mapPorts } = require('../utils/portMapper');
const logger = require('../utils/logger');

const OCM_API_KEY = process.env.OCM_API_KEY;
logger.info(`ocmWorker: API Key ${OCM_API_KEY ? 'Present' : 'MISSING'}`);

// Staleness Thresholds (Synchronized with Database Module)
const TILE_STALENESS_MS = chargerService.TILE_STALENESS_HOURS * 3600000;
const STATUS_STALENESS_MS = chargerService.STATUS_STALENESS_HOURS * 3600000;

/**
 * Main entry point for OCM charger retrieval.
 * Orchestrates tiled fetching, merging, and exact-bbox trimming.
 * 
 * @async
 * @param {Object} bbox - { minLat, minLon, maxLat, maxLon }
 * @param {string} regionId - Legacy/Diagnostic identifier
 * @returns {Promise<Array>} List of chargers within the exact bbox.
 */
const getOCMChargers = async (bbox, regionId) => {
    logger.call('getOCMChargers', `region: ${regionId} | bbox: ${JSON.stringify(bbox)}`);
    
    try {
        const tileKeys = getTileKeysForBbox({
            minLat: bbox.minLat,
            minLng: bbox.minLon,
            maxLat: bbox.maxLat,
            maxLng: bbox.maxLon
        });

        // 1. Parallelize Tile Fetching/Refreshing (Synchronized via fetchTileWithLock)
        const tileResults = await Promise.all(tileKeys.map(key => fetchTileWithLock(key)));
        
        // 2. Merge all chargers from current tiles
        let allChargers = tileResults.flat();

        // 3. Exact-Bbox Trimming (Crucial for Protocol compliance)
        const filtered = allChargers.filter(c => 
            c.lat >= bbox.minLat && c.lat <= bbox.maxLat &&
            c.lng >= bbox.minLon && c.lng <= bbox.maxLon
        );

        // 4. Fire-and-forget background status refresh
        const staleIds = filtered
            .filter(c => (Date.now() - new Date(c.status_refreshed_at)) > STATUS_STALENESS_MS)
            .map(c => c.ocm_id);
        
        if (staleIds.length > 0) {
            setImmediate(() => refreshStaleChargerStatuses(staleIds));
        }

        logger.done('getOCMChargers', `returned: ${filtered.length} chargers`);
        return filtered;

    } catch (err) {
        logger.error(`getOCMChargers failed | ${err.message}`);
        return []; // Resilience: Return empty list rather than breaking route calculation
    }
};

/**
 * Handles the lifecycle of a single spatial tile with the Synchronous Ingestion Protocol.
 * Performs staleness checks and acquires fetching locks if update is needed.
 * 
 * LOGIC:
 * - Request A (Lock Acquired): Awaits full OCM fetch and DB persistence cycle.
 * - Request B (Lock Denied):
 *   - If data is Missing: Wait (poll) for A to finish (Max 10s).
 *   - If data is Stale: Return old data immediately to prevent blocking.
 */
const fetchTileWithLock = async (tileKey) => {
    // Check DB for existing data
    let metadata = await chargerService.getTileMetadata(tileKey);
    const now = Date.now();
    
    const isMissing = !metadata || !metadata.tile_fetched_at;
    const isStale = metadata && (now - new Date(metadata.tile_fetched_at)) > TILE_STALENESS_MS;

    if (isMissing || isStale) {
        const acquired = await chargerService.acquireTileFetchLock(tileKey);
        
        if (acquired) {
            logger.info(`ocmWorker: Fetching Tile [OCM API] | ${tileKey}`);
            try {
                const [latStart, lngStart] = tileKey.replace('tile:', '').split('_').map(Number);
                const tileBbox = {
                    minLat: latStart,
                    minLon: lngStart,
                    maxLat: latStart + 0.5,
                    maxLon: lngStart + 0.5
                };

                // Synchronous Ingestion: Await full API to DB cycle
                const response = await axios.get('https://api.openchargemap.io/v3/poi/', {
                    params: {
                        key: OCM_API_KEY,
                        output: 'json',
                        maxresults: 500,
                        compact: true,
                        verbose: true,
                        boundingbox: `(${tileBbox.minLat},${tileBbox.minLon}),(${tileBbox.maxLat},${tileBbox.maxLon})`
                    },
                    timeout: 10000 // Stage 5 Protocol AXIOS Timeout
                });

                const rawData = response.data || [];
                const formatted = rawData.map(poi => ({
                    ocm_id: poi.ID,
                    name: poi.AddressInfo?.Title || 'Unnamed Charger',
                    lat: poi.AddressInfo?.Latitude,
                    lng: poi.AddressInfo?.Longitude,
                    available_ports: mapPorts(poi.Connections?.map(c => c.ConnectionTypeID)),
                    kw_output: Math.max(...(poi.Connections?.map(c => c.PowerKW) || [0])),
                    is_operational: poi.StatusTypeID === 50,
                }));

                await chargerService.upsertTileChargers(tileKey, formatted, {
                    minLat: tileBbox.minLat,
                    minLng: tileBbox.minLon,
                    maxLat: tileBbox.maxLat,
                    maxLng: tileBbox.maxLon
                });
            } catch (err) {
                logger.error(`Tile fetch failed | ${tileKey} | ${err.message}`);
                // Lock lifecycle is reset by chargerService.upsertTileChargers/catch
            }
        } else if (isMissing) {
            // Secondary Fetcher Polling: Wait for the primary to populate missing data
            logger.info(`ocmWorker: Waiting for concurrent fetch | ${tileKey}`);
            let waitTime = 0;
            const pollInterval = 500;
            const maxWait = 10000;

            while (waitTime < maxWait) {
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                waitTime += pollInterval;
                metadata = await chargerService.getTileMetadata(tileKey);
                
                // Exit wait if data is ready or fetcher failed
                if (metadata && metadata.fetch_status !== 'fetching') {
                    logger.info(`ocmWorker: Wait complete | ${tileKey} | status: ${metadata.fetch_status}`);
                    break;
                }
            }
        }
    }

    // Return the data currently in DB 
    // This is now guaranteed high-fidelity if the first-time fetch was awaited above
    return await chargerService.getChargersByTile(tileKey);
};

/**
 * Targeted background refresh for individual charger statuses.
 */
const refreshStaleChargerStatuses = async (ocmIds) => {
    if (!ocmIds.length) return;
    logger.info(`ocmWorker: Refreshing status for ${ocmIds.length} chargers...`);
    
    try {
        const chunkSize = 25;
        for (let i = 0; i < ocmIds.length; i += chunkSize) {
            const chunk = ocmIds.slice(i, i + chunkSize);
            const response = await axios.get('https://api.openchargemap.io/v3/poi/', {
                params: {
                    key: OCM_API_KEY,
                    id: chunk.join(','),
                    compact: true,
                    verbose: true
                }
            });

            const updates = response.data.map(poi => ({
                ocm_id: poi.ID,
                is_operational: poi.StatusTypeID === 50,
                status_refreshed_at: new Date()
            }));

            await chargerService.upsertTileChargers(null, updates, null); 
        }
    } catch (err) {
        logger.error(`Background status refresh failed | ${err.message}`);
    }
};

module.exports = {
    getOCMChargers
};
