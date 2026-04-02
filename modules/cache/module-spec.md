# Cache Module Specification

## 1. Requirements

### User Stories
- As a backend service, I need a Redis client to check for cached routes and avoid redundant computations.
- As a developer, I need a reliable health-check to ensure the cache layer is operational.

### Acceptance Criteria (Step 3: Dynamic Ingestion)
- **Status**: ✅ VERIFIED
- `services/osmWorker.js` implemented using native Node.js `fetch`.
- Coordinate quantization (4 decimal places) for cache key generation (~11m precision).
- Custom LRU Eviction using a Redis Sorted Set (`osm_metadata`) to cap cache at `MAX_CACHE_ENTRIES` (default: 1000).
- Full `highway` tag ingestion from OSM Overpass API.
- Promise memoization to prevent redundant concurrent fetches for identical bounding boxes.

## 2. Design

### Architecture & Stack
- **Runtime**: Node.js (v18+)
- **Client**: `ioredis` (v5+), compatible with Redis and Valkey.
- **HTTP**: Native Node.js `fetch` (for security and zero-dependency footprint).
- **Configuration**: `dotenv` driven (`REDIS_HOST`, `REDIS_PORT`, `MAX_CACHE_ENTRIES`).

### Directory Structure
- `index.js`: Health-check and diagnostic entry point (Redis + OSM Worker).
- `services/redisClient.js`: Core Redis connection and utility logic.
- `services/osmWorker.js`: Dynamic map ingestion, quantization, and caching logic.
- `utils/logger.js`: Customized module-prefixed logger (`[CACHE]`).

### API Contract (For Other Agents)
The Cache module provides a unified interface for map data. Other modules should interact primarily with `osmWorker.js`.

```js
// services/osmWorker.js
const { getMapData } = require('./services/osmWorker');

/**
 * Fetches or retrieves cached OSM highway data for a bounding box.
 * @param {Object} bbox - Geographical bounds
 * @param {number} bbox.minLat - Minimum Latitude
 * @param {number} bbox.minLon - Minimum Longitude
 * @param {number} bbox.maxLat - Maximum Latitude
 * @param {number} bbox.maxLon - Maximum Longitude
 * @returns {Promise<Object>} - OSM JSON elements (Nodes and Ways)
 */
const data = await getMapData({ 
  minLat: 51.500, 
  minLon: -0.100, 
  maxLat: 51.501, 
  maxLon: -0.099 
});
```

### Redis Key Schema
- **Data**: `osm:data:{minLat}:{minLon}:{maxLat}:{maxLon}` (Quantized to 4 decimals).
- **Metadata (ZSET)**: `osm_metadata` - Stores keys with access timestamps (scores) for LRU eviction.

## 3. Verification
- **Unit Tests**: 
    - `tests/cache/redisConnection.test.js`: Verified connection mocking.
    - `tests/cache/osmWorker.test.js`: Rigorous verification of quantization sensitivity, LRU pruning (ZSET logic), and fetch memoization.
- **Manual Verification**: `node modules/cache/index.js` outputs a successful end-to-end ingestion trace.

