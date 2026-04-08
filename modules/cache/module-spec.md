# Cache Module Specification

## 1. Requirements

### User Stories
- As a backend service, I need a Redis client to check for cached routes and avoid redundant computations.
- As a developer, I need a reliable health-check to ensure the cache layer is operational.

### Acceptance Criteria (Quality Guardian Compliance)
- 11. **Standardized Failure Responses**: If the Overpass API returns zero elements or fails after exhausted retries, the module returns a valid, empty `MapPayload` (0 nodes/edges) instead of throwing. This prevents cascading 500 errors in the Backend.
- 12. **Weight Safety & Fallbacks**: Ensures `weight_m` is always a finite positive number (defaults to `1.0` if calculation fails) to prevent routing engine pathologies.
- 13. **Binary Keying**: Uses `osm:pb:` prefix for binary payloads to ensure Routing Engine v2.0 compatibility.
- 14. **LRU Eviction**: Caps cache at `MAX_CACHE_ENTRIES` using Redis ZSET metadata tracking (`osm_metadata`). Eviction is triggered when the ZSET cardinality exceeds the limit, removing the entry with the lowest score (oldest timestamp).
- 15. **Promise Memoization**: Prevents concurrent duplicate fetches for the same area using an in-memory `pendingFetches` map.
- 16. **API Robustness**: Implements exponential backoff (starting at 2s, doubling per retry) and client-side timeouts (via `AbortController`) for Overpass API requests.
- 17. **Refactored Cache-Aside**: Uses a shared HOF (`withCacheAside`) to unify JSON and Protobuf codepaths, ensuring consistent LRU and memoization behavior.

## 2. Design

### Architecture & Stack
- **Runtime**: Node.js (v18+)
- **Client**: `ioredis` (v5+).
- **Core Dependencies**: `modules/database` (for OCM persistence and spatial tiling).
- **Configuration**: Module-level `.env` required (contains `OCM_API_KEY`). Persistence configuration (`MONGO_URI`) is inherited from the orchestration layer or `modules/database` to prevent connection conflicts.

### Directory Structure
- `index.js`: Diagnostic entry point for module health.
- `services/redisClient.js`: Connection management.
- `services/osmWorker.js`: Map data lifecycle and Protobuf orchestration.
- `utils/haversine.js`: Geographic distance utility.
- `utils/logger.js`: Buffered Markdown-compatible logger.

## 3. Verification

### Automated Tests
- `npm run lint`: Zero-violation ESLint compliance.
- `npm test`: Success on all cache and worker test suites.

### Manual Verification
- `node modules/cache/index.js`: Outputs successful ingestion trace.

## 4. Maintenance (Quality Guardian)

### Refactoring Policy
- **Thread Safety**: The `ioredis` client is shared across all services. Handle concurrent state within the `osmWorker` scope via the `pendingFetches` map.
- **Quantization Integrity**: All map ingestion logic must pass through `osmWorker.quantize()` to ensure key consistency.

### Quality Standards
- 100% ESLint compliance (Single Quotes, 4-space indent).
- Mandatory JSDoc for all exported functions.
- **Zero-Mongoose Policy**: No direct MongoDB connections or Mongoose models are allowed in this module. All persistent storage must be delegated to the `database` module via its service layer.
- **Synchronous Ingestion Protocol**: Guarantees high-fidelity maps on the very first request for a new region. Concurrent fetchers for *missing* data must poll and wait (500ms intervals, max 10s wait) for the primary worker to populate the database. Concurrent fetchers for *stale* data must return old results immediately to maintain non-blocking performance.
- **Environment Safety**: This module must *never* define its own `MONGO_URI` in `.env` to prevent overriding global Atlas connection strings during orchestration.
- Synchronized log synchronization with the global `Output/` directory via the request context.
### 5. The War Room (Bugs Faced & Solved)

#### 5.1 The Anonymous Node Syndrome
**Issue**: Missing node names in algorithm logs (BFS/Dijkstra) made debugging difficult.
- **Root Cause**: Overpass query optimization (`out skel`) stripped all node tags, and the conversion logic only checked for `el.tags?.name`.
- **Resolution**: Updated `fetchMapData` to use `out qt` for nodes to fetch tags.
- **Inheritance Logic**: Implemented way-name propagation where a node without its own `name` tag inherits the name of its parent `way`. Ensures logs display "(Main Street)" correctly.

#### 5.2 The 504 Gateway Timeout Crisis
**Issue**: High traffic or complex queries on the Overpass API resulted in 504 Gateway Timeouts, stalling the map ingestion pipeline.
- **Root Cause**: Lack of client-side timeouts and retry logic; queries were not optimized for server-side processing limits.
- **Resolution**:
    - **Server-Side Hinting**: Added `[timeout:25]` to all Overpass QL queries.
    - **Client-Side Guard**: Implemented `AbortController` with a configurable `OSM_TIMEOUT_MS` (default 30s).
    - **Resilience**: Added exponential backoff retry logic (starting at 2s, doubling) for 503/504 status codes, controlled by `OSM_REQ_RETRY_COUNT`.
#### 5.4 The "Ocean" Problem (Empty Responses)
**Issue**: Requests in regions with no roads caused the gRPC layer to fail or throw errors due to empty data elements.
- **Resolution**: Implemented **Standardized Failure Responses**. If the Overpass API returns no data, the `convertToMapPayload` function creates a valid empty Protobuf structure.
- **Benefit**: The Routing Engine receives a valid graph (with zero size) and returns a clean "Path Not Found" result instead of a system crash.
