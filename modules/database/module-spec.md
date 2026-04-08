# Database Module Specification

## 1. Requirements

### User Stories
- **System Architect**: I need a high-availability, persistent data store to log telemetries, user preferences, and pre-computed routes to avoid redundant CPU-heavy calculations.
- **Developer**: I need a robust, schema-driven interface to MongoDB Atlas with deep lifecycle logging and automated connection recovery.

### Design Principles
- **Circuit Breaker Persistence**: Enforce a 5-second `serverSelectionTimeoutMS` to prevent the Node.js event loop from blocking indefinitely during Atlas outages.
- **Credential Isolation**: Automatically mask sensitive URI components in all logs to maintain SOC2-level security standards.
- **Traceability**: Every connection attempt must be wrapped in `[CALL]` and `[DONE]` blocks for synchronization with the global request context.

### Acceptance Criteria (Stage 5 Compliance)
- **Spatial Tiling**: ✅ Fixed-size spatial tiling (0.5° cells) for efficient OCM data storage.
- **Atlas Connectivity**: ✅ Successfully establishes Mongoose connection to MongoDB Atlas Cloud clusters.
- **Lifecycle Management**: ✅ Implements `connectMongo` and `disconnectMongo` with full event-driven logging.
- **Error Resilience**: ✅ Gracefully handles unconfigured environment variables and unreachable clusters with clear, actionable error logs.
- **Tracer Bullet**: ✅ Standalone health check script verified and operational.
- **Testing Coverage**: ✅ Comprehensive unit tests for tiling logic and atomic service operations.

## 2. Design

### Architecture & Stack
- **Language**: Node.js (CommonJS).
- **Library**: Mongoose (v8+) for Object Data Modeling (ODM).
- **Configuration**: Dual-layer `.env` resolution (local override + root system defaults).
- **Context Integration**: `AsyncLocalStorage` via the `logger` utility for request-synchronized trace logs.

### Directory Structure
- `index.js`: Diagnostic entry point and health check suite.
- `models/`: Mongoose schemas for tiles and chargers.
- `services/mongoClient.js`: Connection manager (Singleton pattern).
- `services/chargerService.js`: OCM data persistence and metadata management.
- `utils/logger.js`: Buffered Markdown logger with [DATABASE] prefixing.
- `utils/tileKey.js`: Spatial grid utility for mapping coordinates to tile keys.

### Data Models & API Contracts

#### mongoClient.js
- `connectMongo()`: `Promise<number>` (returns readyState: 1).
- `disconnectMongo()`: `Promise<string>` (returns 'Connection closed').

#### chargerService.js
- `getTileMetadata(tile_key)`: `Promise<Object|null>`.
- `getChargersByTile(tile_key)`: `Promise<Array>`.
- `upsertTileChargers(tile_key, chargers, tileBbox)`: `Promise<void>`.
- `acquireTileFetchLock(tile_key)`: `Promise<boolean>`.

#### Environment Variables
| Variable | Default | Description |
| :--- | :--- | :--- |
| `MONGO_URI` | `null` | Primary MongoDB Atlas connection string. |
| `DEBUG` | `false` | Enables verbose connection event logging. |

## 3. Verification

### Automated Tests
- `npm run lint`: ESLint zero-violation enforcement.
- `npm test`: Jest suite verifying connection lifecycle, masking, and error paths.

### Manual Verification
- Run `node index.js` and verify clean, masked output:
  - `[DATABASE] [CALL] connectMongo | input: MONGO_URI: mongodb+srv://<credentials>@cluster...`
  - `[DATABASE] [DONE] connectMongo | output: readyState=1`

## 4. Maintenance (Quality Guardian)

### Quality Standards
- 100% test coverage for connection services.
- Detailed Doxygen/JSDoc documentation for all exported functions.
- Strict adherence to the [DATABASE] log prefixing for log aggregation.

## 5. Self-Healing Lock Protocol (Stage 5 Hardening)

To prevent "Deadlocked" geographic tiles due to worker crashes during OCM fetching, the module implements a dual-layer self-healing mechanism:

### 5.1 Temporal Expiry (TTL)
- **Timeout**: 5 minutes (300,000ms).
- **Logic**: `acquireTileFetchLock` allows re-acquisition of a `fetching` status if the `updatedAt` timestamp is older than the timeout.
- **Atomic Guard**: Uses the MongoDB `$or` operator to ensure the transition is atomic and prevents race conditions between competing workers.

### 5.2 State Convergence (Forced Reset)
- **Success Path**: Every `upsertTileChargers` call forcibly resets the `fetch_status` to `idle`.
- **Failure Path**: The `catch` block in `upsertTileChargers` explicitly resets the status to `failed` to allow immediate retry by the next background cycle.
- **Metric Sync**: `charger_count` and `tile_fetched_at` are atomically synchronized during the reset to ensure a consistent "Source of Truth" for the cache layer.

