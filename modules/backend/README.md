# Backend Orchestration Module

High-performance, event-driven orchestration layer implemented in Node.js. Serves as the central nerve center for the AI Route Planner, coordinating real-time OSM data ingestion, Redis caching, and gRPC pathfinding execution.

## 1. System Architecture

### 1.1 High-Level Flow
```mermaid
graph TD
    A[Frontend Client] -- "POST /api/routes/calculate" --> B[Express Server]
    B -- "getMapPayload(bbox)" --> C[Cache Module]
    C -- "{ binary, region_id }" --> B
    B -- "CalculateRoute(metadata, map_data_pb, region_id)" --> D[Routing Engine]
    D -- "5-Algo Suite" --> B
    B -- "Standardized Result JSON" --> A
```

### 1.2 Orchestration Lifecycle
```mermaid
sequenceDiagram
    participant F as Frontend
    participant B as Backend
    participant C as Cache (Redis)
    participant E as Engine (gRPC)

    F->>B: Submit (Start, End)
    Note over B: AsyncLocalStorage Setup
    B->>B: Generate Atomic UID (e.g. 1001)
    B->>C: OSM Ingestion (BBox)
    C-->>B: { binary: MapPayload, region_id }
    Note right of B: Protobuf Serialized Flow
    B->>E: CalculateRoute(map_data_pb, region_id, log_dir: 1001)
    E-->>B: Vector<AlgorithmResult>
    B->>B: Log Buffer Flush (Output/1001_...)
    B-->>F: JSON Response (Standardized Failure Signature)
```

## 2. Architectural Breakthroughs (Post-v1.0.0)

### 2.1 The "City-Scale" Ingestion (Protobuf v2)
*   **The Problem**: Requesting a route across a high-density urban center (e.g., New York) generates a 50MB+ OSM road network. Standard gRPC payloads are limited to 4MB, and single-threaded JSON parsing can block the Node.js event loop.
*   **The Solution**: **Protobuf Binary Serialization**. We transitioned from JSON stringification to binary `MapPayload` buffers (`map_data_pb`). This reduces I/O time and offloads deserialization to the C++ core.
*   **Outcome**: Sub-1ms overhead in the primary orchestration thread for massive urban road networks.

### 2.2 Unified Request Tracing (`AsyncLocalStorage`)
*   **The Problem**: Debugging a distributed search (Backend -> Cache -> Engine) was impossible without a shared identifier to link log fragments.
*   **The Solution**: **Atomic UID & Log Buffering**. Using `AsyncLocalStorage`, we maintain a per-request buffer that collects traces from all asynchronous layers. These are flushed to a single session folder (e.g., `Output/1001_...`) upon completion.
*   **Outcome**: 100% observability across the entire request lifecycle.

### 2.3 Semantic Error Mapping & Circuit Breakers
*   **The Problem**: Timeouts or "Silent" OSM failures would return misleading results (e.g., 0m distance routes).
*   **The Solution**: **Semantic Mapping (504/503)**. The backend now maps gRPC `DEADLINE_EXCEEDED` to `504` and `UNAVAILABLE` to `503`.
*   **The Failure Signature**: When an algorithm exceeds `ALGO_MAX_NODES`, the backend enforces a standardized response: `distance: 0`, `path_cost: 0`, `nodes_expanded: 1,000,001`, and `circuit_breaker_triggered: true`.

## 3. API & Contracts

### POST `/api/routes/calculate`
| Field | Type | Description |
| :--- | :--- | :--- |
| `start/end` | `Object` | `{ lat: number, lng: number }` |
| `mock_hour` | `Number` | Simulation time (0-23) for traffic weighting. |
| `objective` | `String` | `"FASTEST"` or `"SHORTEST"`. |

**Standard Response**: Encapsulates 5 algorithm results (BFS, Dijkstra, IDDFS, A*, IDA*) with polylines and performance metrics.

## 4. The War Room: Bugs Faced & Solved

### 4.1 The gRPC `RESOURCE_EXHAUSTED` Crash
**Issue**: Large map data payloads caused immediate connection resets during gRPC transmission between Backend and Engine.
**Solution**: Configured the gRPC client to use `grpc.max_send_message_length: 52428800`. Verified the fix with a 40k-node map ingestion test.

### 4.2 The `target` Scope ReferenceError
**Issue**: A regression during refactoring caused the `target` connection string in `grpcClient.js` to be undefined at runtime.
**Solution**: Restored the `process.env.ROUTING_ENGINE_URL` variable with a hardcoded fallback to `localhost:50051`, and updated the **Quality Guardian** protocol to catch variable-scoping errors during unit tests.

### 4.3 The Async Context Leak
**Issue**: Requests would occasionally hang because `AsyncLocalStorage` context was not being unregistered in error blocks.
**Solution**: Implemented a mandatory `finally` block in the controller to ensure `unregisterContext()` is called regardless of request outcome.

### 4.4 The "Silent" OSM Failure (1-Node Path)
**Issue**: When the OSM API failed (504), the backend would log a warning but proceed to call the Routing Engine with empty map data, resulting in a misleading "successful" response with a 0m distance route.
**Solution**: Refactored `calculateRoute.js` to treat OSM ingestion as mandatory. Failures now trigger an immediate 503 response. Improved stability via `OSM_TIMEOUT_MS` (30s) cutoff.

### 4.5 The "Partial Result" UI Ghosting
**Issue**: When IDA* hit its circuit breaker, it might return a partial path or null data, causing inconsistent frontend displays.
**Solution**: Standardized the **Failure Signature** in the backend. When `ALGO_MAX_NODES` is exceeded, the backend now returns `path_cost: 0`, `distance: 0`, and `nodes_expanded: 1,000,001`, explicitly flagging the failure for the frontend toasts.
**Optimization**: To prevent trace logs from bloating to 99MB+ for long routes, `requestLogger.js` now intercepts all successful route responses and logs a summarized metadata object (`algorithm`, `distance`, `nodes_expanded`, `nodes_in_path`) instead of raw coordinate arrays.

## 5. Configuration (Environment Variables)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Express server port. |
| `ROUTING_ENGINE_URL` | `localhost:50051` | Target address for the C++/Python search engine. |
| `GRPC_MAX_MESSAGE_SIZE` | `50MB` | Binary payload limit for large map ingestion. |
| `OSM_TIMEOUT_MS` | `30s` | Configurable cutoff for upstream map fetching. |
| `OSM_REQ_RETRY_COUNT` | `3` | Number of retries for OSM 503/504 errors. |
| `ALGO_MAX_NODES` | `1M` | Node expansion limit for circuit breaker evaluation. |
| `LOG_FLUSH_INTERVAL` | `0` | Interval (sec) for emergency log flushes (0 = disable). |
| `DEBUG` | `false` | Enables full request/response console logging. |

## 6. Build and Lifecycle

### 6.1 Run Development Server
```bash
npm run dev
```

### 6.2 Execute Tests
```bash
node tests/main_test_runner.js
```

## 7. System Integration & Use Cases

### 7.1 Extending Request Context
To add a new cross-module metric (e.g., telemetry):
1. Add the field to the `context` object in `calculateRoute.js`.
2. Access the field anywhere in the request flow via `storage.getStore()`.

### 7.2 Modifying API Contracts
If you update the gRPC interface in the Engine:
1. Update `proto/route_engine.proto`.
2. The `grpcClient.js` will automatically load the new definition on restart.
