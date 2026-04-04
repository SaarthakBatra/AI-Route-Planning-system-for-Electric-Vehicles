# Cache Module Specification

## 1. Requirements

### User Stories
- As a backend service, I need a Redis client to check for cached routes and avoid redundant computations.
- As a developer, I need a reliable health-check to ensure the cache layer is operational.

### Acceptance Criteria (Quality Guardian Compliance)
- **Status**: ✅ VERIFIED (2026-04-04)
- **Dynamic Ingestion**: Implemented using native Node.js `fetch` to eliminate external dependencies.
- **Quantization**: Forced 4-decimal precision (~11m) for stable cache keys.
- **LRU Eviction**: Caps cache at `MAX_CACHE_ENTRIES` using Redis ZSET metadata tracking.
- **Promise Memoization**: Prevents concurrent duplicate fetches for the same area.

## 2. Design

### Architecture & Stack
- **Runtime**: Node.js (v18+)
- **Client**: `ioredis` (v5+).
- **Configuration**: Module-level `.env` required.

### Directory Structure
- `index.js`: Diagnostic entry point for module health.
- `services/redisClient.js`: Connection management.
- `services/osmWorker.js`: Map data lifecycle orchestrator.
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
- Synchronized log synchronization with the global `Output/` directory via the request context.
