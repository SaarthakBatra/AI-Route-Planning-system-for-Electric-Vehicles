// AI Route Planner - Cache Module - v2.0.1 (Cache-Bust Fix)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const protobuf = require('protobufjs');
const { client } = require('./redisClient');
const logger = require('../utils/logger');
const { calculateHaversine } = require('../utils/haversine');
const { getElevation } = require('./elevationService');
const { getOCMChargers } = require('./ocmWorker');
const { mapPorts } = require('../utils/portMapper');

/**
 * @fileoverview OSM API Worker for dynamic map ingestion, Protobuf conversion, and caching.
 *
 * Workflow:
 *  1. Quantize coordinates (4 decimal places) for cache hitting and region identification.
 *  2. Check Redis for existing binary (Protobuf) or JSON data under region-specific keys.
 *  3. Handle Cache Miss:
 *      a. Check in-memory `pendingFetches` to prevent duplicate concurrent API calls.
 *      b. Fetch street data from OSM Overpass API with exponential backoff and timeouts.
 *      c. Convert OSM JSON to binary-serialized MapPayload Protobuf messages.
 *      d. Pre-calculate edge weights (meters) using the Haversine formula and map speeds.
 *      e. Propagate way-names to nodes for enhanced logging diagnostics.
 *  4. Persistence & LRU:
 *      a. Store results in Redis and update the `osm_metadata` ZSET with access timestamps.
 *      b. Evict the oldest entry if `MAX_CACHE_ENTRIES` is exceeded.
 */

const MAX_CACHE_ENTRIES = parseInt(process.env.MAX_CACHE_ENTRIES, 10) || 1000;
const OSM_TIMEOUT_MS = parseInt(process.env.OSM_TIMEOUT_MS, 10) || 30000;
const OSM_REQ_RETRY_COUNT = parseInt(process.env.OSM_REQ_RETRY_COUNT, 10) || 3;
const METADATA_KEY = 'osm_metadata';
const PROTO_PATH = path.resolve(__dirname, '../../routing_engine/proto/route_engine.proto');

/**
 * Helper to delay execution (ms).
 * @param {number} ms 
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// In-memory memoization to prevent concurrent fetches for the same bbox
const pendingFetches = new Map();

// Default speeds for road types when maxspeed tag is missing (km/h)
const HIGHWAY_SPEEDS = {
    'motorway': 120,
    'trunk': 100,
    'primary': 80,
    'secondary': 60,
    'tertiary': 40,
    'unclassified': 30,
    'residential': 30,
    'service': 20,
    'living_street': 20
};

/**
 * Quantize a coordinate to 4 decimal places (~11m precision).
 * @param {number} val 
 * @returns {number}
 */
const quantize = (val) => parseFloat(Number(val).toFixed(4));

/**
 * Generates a consistent region identifier for a bounding box.
 * Format: bbox:lat_min_lng_min_lat_max_lng_max
 * @param {Object} bbox - { minLat, minLon, maxLat, maxLon }
 * @returns {string}
 */
const getRegionId = (bbox) => {
    const minLat = quantize(bbox.minLat);
    const minLon = quantize(bbox.minLon);
    const maxLat = quantize(bbox.maxLat);
    const maxLon = quantize(bbox.maxLon);
    return `bbox:${minLat}_${minLon}_${maxLat}_${maxLon}`;
};

/**
 * Converts OSM JSON elements into a binary MapPayload Protobuf.
 * Maps OSM IDs to sequential internal int32 IDs as required by the proto.
 * 
 * Stage 5 Enhancements:
 *  - Bilinear SRTM interpolation for every node.
 *  - Native OSM and OCM-source charging POI injection.
 *  - MAX_FLOAT fail-safe for topological breaks.
 *
 * @param {Object} osmData - Raw JSON from Overpass API.
 * @param {Object} bbox - Bounding box.
 * @param {string} regionId - Local region key.
 * @returns {Promise<Buffer>} Binary serialized MapPayload.
 */
const convertToMapPayload = async (osmData, bbox, regionId) => {
    const root = await protobuf.load(PROTO_PATH);
    const MapPayload = root.lookupType('route_engine.MapPayload');
    const EdgeProto = root.lookupType('route_engine.EdgeProto');
    const NodeProto = root.lookupType('route_engine.NodeProto');
    
    // 0. Fetch OCM Chargers for merging
    const ocmChargers = await getOCMChargers(bbox, regionId);

    const nodesById = new Map();
    const osmToInternal = new Map();
    const nodesProto = [];
    const edgesProto = [];
    let internalIdCounter = 0;

    // 1. Process OSM Nodes
    for (const el of osmData.elements || []) {
        if (el.type === 'node') {
            const internalId = internalIdCounter++;
            const { elevation, confidence } = await getElevation(el.lat, el.lon);
            
            const rawName = el.tags?.name || el.tags?.['name:en'] || el.tags?.int_name || '';

            // POI Ingestion (OSM Native)
            const isCharger = el.tags?.amenity === 'charging_station';
            const isEmergency = el.tags?.amenity === 'fuel' || el.tags?.amenity === 'restaurant';
            
            const node = NodeProto.create({
                id: internalId,
                lat: el.lat,
                lng: el.lon,
                name: rawName,
                elevation: elevation,
                elevationConfidence: confidence,
                isCharger: isCharger || isEmergency,
                chargerType: isEmergency ? 'EMERGENCY' : (el.tags?.['socket:type2'] ? 'IEC_62196_T2' : 'CANONICAL'),
                kwOutput: isEmergency ? 3.0 : (parseFloat(el.tags?.max_power) || 0),
                isOperational: el.tags?.operational_status !== 'closed',
                isEmergencyAssumption: isEmergency
            });
            osmToInternal.set(el.id, internalId);
            nodesById.set(el.id, node);
            nodesProto.push(node);
        }
    }

    // 1.1 Process OCM Chargers (Injection)
    for (const charger of ocmChargers) {
        const internalId = internalIdCounter++;
        const { elevation, confidence } = await getElevation(charger.location.coordinates[1], charger.location.coordinates[0]);
        
        const node = NodeProto.create({
            id: internalId,
            lat: charger.location.coordinates[1],
            lng: charger.location.coordinates[0],
            name: charger.name,
            elevation: elevation,
            elevationConfidence: confidence,
            isCharger: true,
            chargerType: 'OCM_SOURCE',
            kwOutput: charger.kw_output,
            isOperational: charger.is_operational,
            availablePorts: charger.available_ports.map(p => root.lookupEnum('route_engine.PortType').values[p] || 0),
            isEmergencyAssumption: false
        });
        nodesProto.push(node);
    }

    /**
     * Helper to validate node coordinates before distance calculation.
     * @param {Object} node 
     * @returns {boolean}
     */
    const isValidCoord = (node) => node && Number.isFinite(node.lat) && Number.isFinite(node.lng);

    // 2. Process Ways into Edges
    osmData.elements.forEach(el => {
        if (el.type === 'way' && el.nodes) {
            const highway = el.tags?.highway;
            if (!highway) return;

            // Name Propogation: If nodes on this way have no name, assign them the way's name
            const wayName = el.tags?.name || el.tags?.['name:en'];
            if (wayName) {
                el.nodes.forEach(nodeId => {
                    const node = nodesById.get(nodeId);
                    if (node && !node.name) {
                        node.name = wayName;
                    }
                });
            }

            // Priority: maxspeed tag > highway type default > global default (30)
            const maxSpeedTag = el.tags?.maxspeed;
            const speed_kmh = Number(parseInt(maxSpeedTag) || HIGHWAY_SPEEDS[highway] || 30);
            const road_type = highway;

            for (let i = 0; i < el.nodes.length - 1; i++) {
                const uId = el.nodes[i];
                const vId = el.nodes[i + 1];

                const u = nodesById.get(uId);
                const v = nodesById.get(vId);

                if (u && v) {
                    let weight_m = 3.402823e+38; // Default to MAX_FLOAT (32-bit float limit)

                    if (isValidCoord(u) && isValidCoord(v)) {
                        const dist = calculateHaversine(u.lat, u.lng, v.lat, v.lng);
                        if (Number.isFinite(dist) && dist > 0) {
                            weight_m = dist;
                        }
                    }

                    edgesProto.push(EdgeProto.create({
                        u: osmToInternal.get(uId),
                        v: osmToInternal.get(vId),
                        weightM: weight_m,
                        speedKmh: speed_kmh,
                        roadType: road_type
                    }));
                }
            }
        }
    });

    const payload = MapPayload.create({
        nodes: nodesProto,
        edges: edgesProto
    });

    // --- Integrity Checks ---
    if (nodesProto.length === 0) {
        // Return valid empty payload rather than throwing, satisfying Standardized Failure Protocol
        return MapPayload.encode(payload).finish();
    }
    
    // Validate edge indices against nodes array
    edgesProto.forEach((edge, index) => {
        if (edge.u >= nodesProto.length || edge.v >= nodesProto.length) {
            throw new Error(`Integrity violation: Edge ${index} refers to out-of-bounds node index.`);
        }
    });

    const errMsg = MapPayload.verify(payload);
    if (errMsg) throw Error(errMsg);

    return MapPayload.encode(payload).finish();
};

/**
 * Internal Cache-Aside orchestrator. Handles Hit/Miss, Pending fetches, and LRU Updates.
 * 
 * Logic sequence:
 *  1. Check Redis for existing data.
 *  2. Check `pendingFetches` for in-flight requests for the same key.
 *  3. Fetch/Transform via providing processing callback.
 *  4. Persist result and update LRU.
 * 
 * @param {string} key - Redis key (prefixed).
 * @param {Function} fetchFn - Async callback to run on miss.
 * @param {boolean} isBinary - Whether to use getBuffer/set instead of get/set.
 * @param {string} [callerName] - Name of the function for logging.
 * @returns {Promise<any>} The data (Buffer or JSON).
 */
const withCacheAside = async (key, fetchFn, isBinary = false, callerName = 'withCacheAside') => {
    try {
        // 1. Redis Hit
        const cached = isBinary ? await client.getBuffer(key) : await client.get(key);
        if (cached) {
            logger.info(`Cache HIT [${isBinary ? 'PB' : 'JSON'}] | key: ${key}`);
            await client.zadd(METADATA_KEY, Date.now(), key);
            if (callerName) logger.done(callerName, 'HIT');
            return isBinary ? cached : JSON.parse(cached);
        }

        // 2. Pending Fetch Check (Deduplication)
        if (pendingFetches.has(key)) {
            logger.info(`Attaching to pending fetch | key: ${key}`);
            return await pendingFetches.get(key);
        }

        // 3. Cache Miss - Execute Fetch
        const workPromise = (async () => {
            try {
                const result = await fetchFn();
                
                // Store in Redis
                if (isBinary) {
                    await client.set(key, result);
                } else {
                    await client.set(key, JSON.stringify(result));
                }
                await client.zadd(METADATA_KEY, Date.now(), key);
                
                // LRU Eviction
                const count = await client.zcard(METADATA_KEY);
                if (count > MAX_CACHE_ENTRIES) {
                    const oldest = await client.zrange(METADATA_KEY, 0, 0);
                    if (oldest.length > 0) {
                        logger.info(`Evicting oldest entry | key: ${oldest[0]}`);
                        await client.del(oldest[0]);
                        await client.zrem(METADATA_KEY, oldest[0]);
                    }
                }
                return result;
            } finally {
                pendingFetches.delete(key);
            }
        })();

        pendingFetches.set(key, workPromise);
        return await workPromise;
    } catch (err) {
        logger.error(`withCacheAside failed | key: ${key} | error: ${err.message}`);
        throw err;
    }
};

/**
 * Retrieves raw OSM JSON elements for a bounding box (Legacy Support).
 * Satisfies existing unit tests and backward compatibility.
 * 
 * @param {Object} bbox - Bounding box { minLat, minLon, maxLat, maxLon }.
 * @returns {Promise<Object>} Raw OSM JSON elements.
 */
const getMapData = async (bbox) => {
    const regionId = getRegionId(bbox);
    const key = `osm:data:${regionId.replace('bbox:', '')}`;
    logger.call('getMapData', `key: ${key}`);
    
    try {
        return await withCacheAside(key, async () => {
            const data = await fetchMapData(bbox);
            logger.done('getMapData', `FETCHED elements: ${data.elements?.length || 0}`);
            return data;
        }, false, 'getMapData');
    } catch (err) {
        logger.error(`getMapData failed | error: ${err.message}`);
        throw err;
    }
};

/**
 * Fetches map data from OSM Overpass API.
 * Uses AbortController for timeouts and exponential backoff for retries on 503/504 errors.
 * @param {Object} bbox
 * @returns {Promise<Object>}
 */
const fetchMapData = async (bbox) => {
    const { minLat, minLon, maxLat, maxLon } = bbox;
    // Expanded for Stage 5: Include nodes with amenity=charging_station or fuel or restaurant
    const query = `[out:json][timeout:25];(way["highway"](${minLat},${minLon},${maxLat},${maxLon});node["amenity"~"charging_station|fuel|restaurant"](${minLat},${minLon},${maxLat},${maxLon}););out body;>;out qt;`;
    const url = 'https://overpass-api.de/api/interpreter';
    
    let lastError;
    let backoffMs = 2000; // Start at 2s backoff

    for (let attempt = 0; attempt <= OSM_REQ_RETRY_COUNT; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), OSM_TIMEOUT_MS);

        try {
            if (attempt > 0) {
                logger.info(`Retrying OSM fetch (Attempt ${attempt}/${OSM_REQ_RETRY_COUNT}) | backoff: ${backoffMs}ms`);
                await delay(backoffMs);
                backoffMs *= 2;
            }

            logger.info(`Fetching OSM data from Overpass | bbox: ${minLat},${minLon},${maxLat},${maxLon}`);
            
            const response = await fetch(url, {
                method: 'POST',
                body: 'data=' + encodeURIComponent(query),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = new Error(`OSM API error: ${response.status} ${response.statusText}`);
                error.status = response.status;
                
                // Retry on 503/504
                if ((response.status === 503 || response.status === 504) && attempt < OSM_REQ_RETRY_COUNT) {
                    lastError = error;
                    continue;
                }
                throw error;
            }
            
            const data = await response.json();
            logger.info(`OSM Data Received | elements: ${data.elements?.length || 0}`);
            return data;

        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                lastError = new Error(`OSM Fetch Timeout after ${OSM_TIMEOUT_MS}ms`);
                lastError.status = 408; // Request Timeout
            } else {
                lastError = err;
            }
            
            if (attempt < OSM_REQ_RETRY_COUNT) continue;
            throw lastError;
        }
    }
    throw lastError;
};

/**
 * Retrieves a binary-serialized MapPayload for a bounding box (Cache-Aside).
 * Uses 'osm:pb:' prefix for v2 binary data to ensure Routing Engine v2.0 compatibility.
 * 
 * Workflow:
 *  1. Quantizes input bbox.
 *  2. Checks binary cache for regionID.
 *  3. On miss: Fetch map data, convert to Protobuf, and store results.
 * 
 * @param {Object} bbox - Bounding box { minLat, minLon, maxLat, maxLon }.
 * @returns {Promise<{ binary: Buffer, region_id: string }>} Serialized Protobuf buffer and region identifier.
 */
const getMapPayload = async (bbox) => {
    const regionId = getRegionId(bbox);
    const key = `osm:pb:${regionId.replace('bbox:', '')}`;
    logger.call('getMapPayload', `key: ${key}`);

    try {
        const binary = await withCacheAside(key, async () => {
            const osmJson = await fetchMapData(bbox);
            return await convertToMapPayload(osmJson, bbox, regionId);
        }, true, 'getMapPayload');

        logger.done('getMapPayload', `SUCCESS length: ${binary.length}B`);
        return { binary, region_id: regionId };
    } catch (err) {
        logger.error(`getMapPayload failed | error: ${err.message}`);
        throw err;
    }
};

module.exports = {
    getMapPayload,
    getMapData,     // Legacy JSON support
    getBBoxKey: getRegionId, // Alias for tests
    getRegionId,
    quantize,
    convertToMapPayload
};
