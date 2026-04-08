# Database Module

Persistent data storage and lifecycle management for the AI Route Planner. This module interfaces with MongoDB Atlas using Mongoose, providing a robust synchronization layer for the system's telemetry and pre-computed results.

## 1. System Architecture

### 1.1 Connection Lifecycle Flow
```mermaid
sequenceDiagram
    participant B as Backend/App
    participant DC as mongoClient.js
    participant L as logger.js
    participant MA as MongoDB Atlas

    B->>DC: connectMongo()
    DC->>L: [CALL] connectMongo (Masked URI)
    DC->>MA: mongoose.connect()
    MA-->>DC: Connection Established
    DC->>L: [INFO] Mongoose connected (Host)
    DC->>L: [DONE] connectMongo (ReadyState=1)
    DC-->>B: success (1)
```

### 1.2 Data Persistence Strategy
```mermaid
graph LR
    A[Request Context] --> B[Log Buffer]
    B --> C{Sync to Disk?}
    C -- "Yes (Success)" --> D[Output/<UID>/database.md]
    C -- "Yes (Error)" --> E[Output/Error_logs/]
```

## 2. Real-World Scenarios

### Scenario A: The Atlas "Cold Start"
*   **The Problem**: After a period of inactivity or a cluster maintenance window, initial connection attempts can take 2-3 seconds, potentially delaying critical route calculations.
*   **The Solution**: Implemented a **Circuit Breaker** with a 5s `serverSelectionTimeoutMS`.
*   **Engine Behavior**: The module fails fast if the cluster is unreachable, allowing the orchestrator to fall back to the cache layer or return a graceful 503 instead of hanging the Node.js event loop.

### Scenario B: Credential Leaks in Production Logs
*   **The Problem**: Standard database connection strings contain plain-text passwords. Logging these violates security protocols.
*   **The Solution**: **Automatic URI Masking**.
*   **Engine Behavior**: The `mongoClient` uses a regex replacer `MONGO_URI.replace(/:\/\/[^@]+@/, '://<credentials>@')` before passing the URI to the logger, ensuring zero sensitive data exposure.

## 3. Algorithm Performance Matrix (Connection)

| Operation | Target Latency | Optimization | Status |
| :--- | :--- | :--- | :--- |
| **Initial Connect** | < 1000ms | Connection Pooling | ✅ Stable |
| **Re-connection** | < 200ms | Mongoose buffering | ✅ Stable |
| **Credential Masking**| < 1ms | Pre-compiled Regex | ✅ Verified |

## 4. The War Room: Bugs Faced & Solved

### 4.1 The "Hanging Process" Mystery
**Issue**: Running the health check via `node index.js` would successfully connect but never return to the shell prompt, causing CI/CD timeouts.
**Solution**: Discovered that Mongoose maintains an active socket pool even after a successful health check. Added `await disconnectMongo()` to the `runHealthCheck` sequence.

### 4.2 The `.env` Path Ambiguity
**Issue**: When the database module was required by the `backend`, it failed to find `MONGO_URI` because it was looking for `.env` in the wrong relative directory.
**Solution**: Refactored to a **dual-layer .env loader** that explicitly checks both `path.join(__dirname, '.env')` and `path.join(__dirname, '../../.env')`.

## 5. Configuration (Environment Variables)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `MONGO_URI` | `null` | MongoDB Atlas Cluster URI. |
| `DEBUG` | `false` | Enables verbose lifecycle event logging. |

## 6. Lifecycle Commands

### 6.1 Install Dependencies
```bash
npm install
```

### 6.2 Run Health Check
```bash
node index.js
```

### 6.3 Execute Test Suite
```bash
npm test
```

### 6.4 Formatting & Linting
```bash
npm run lint
```

## 8. OCM Spatial Tiling (Stage 5)

Implemented a fixed-size spatial tiling system (0.5° cells) for persistent OCM data storage.

### 8.1 Tile Key Logic
Uses `Math.floor(coord / 0.5) * 0.5` to ensure stable string keys (e.g., `tile:28.0_75.5`).

### 8.2 Models & Indices
- **OcmTile**: Metadata for tracking fetch status and staleness.
- **OcmCharger**: Detailed charger telemetry with a `2dsphere` GeoJSON index for high-fidelity spatial lookups.

### 8.3 Service Contracts
- `getTileMetadata(tile_key)`: Retrieves tile lifecycle information.
- `upsertTileChargers(tile_key, chargers, tileBbox)`: Atomic `bulkWrite` for chargers and metadata updates.
- `acquireTileFetchLock(tile_key)`: Atomic lock to prevent concurrent fetch operations.

## 9. MongoDB Atlas Quick Setup
1. Create a free account at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas).
2. Create an **M0 cluster**.
3. Add a database user (Read/Write).
4. Whitelist `0.0.0.0/0` (for development).
5. Copy the connection string and paste it into your `.env` file.

## 10. Self-Healing Protocol (Lock Expiry)

To prevent geographic tiles from being permanently locked in a `fetching` state due to worker crashes, the module implements a **Self-Healing Lock Protocol**:

1. **5-Minute TTL**: Locks (`fetching` status) automatically expire after 300,000ms.
2. **Atomic Recovery**: `acquireTileFetchLock` uses an `$or` query to re-acquire expired locks safely.
3. **Success Convergence**: Every data write (`upsertTileChargers`) forcibly resets the status to `idle`.
4. **Failure Recovery**: Exceptions during ingestion trigger a `failed` status reset to enable immediate retries.

This ensures high availability for spatial data updates even in unstable distributed environments.

