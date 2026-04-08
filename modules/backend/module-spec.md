# Backend Module Specification

## 1. Requirements

### 1.1 User Stories
- As a frontend client, I need a reliable REST API to submit geographic coordinates and receive optimal route paths.
- As an architect, I need the backend to serve as an orchestration layer that interfaces with Redis (cache), MongoDB (telemetry), and the Python/C++ gRPC Routing Engine.

### 1.2 Design Principles
- **Orchestration Only**: The backend must never execute business logic or pathfinding; it strictly delegates to microservices.
- **Context Preservation**: Use `AsyncLocalStorage` to maintain an atomic log buffer per request.
- **Standardized Headers**: Quality Guardian compliant headers for maintenance and traceability.
- **Fail-Safe Operation**: Mandatory OSM ingestion; failures must return 503 to prevent trivial (1-node) path returns.
- **Configurable Cutoff**: Implementation-specific timeouts (default 30s) via `OSM_TIMEOUT_MS`.

### 1.3 Acceptance Criteria
- **City-Scale Orchestration**: ✅ Manages 100MB+ binary payloads without blocking the main thread.
- **Bounding Box Precision**: ✅ Calculates geographical search zones with 4-decimal quantization for cache hits.
- **Protobuf Serialized**: ✅ Efficiently transmits map data via binary `map_data_pb` in gRPC requests.
- **Atomic UID**: ✅ Every request is uniquely identifiable via an incremental integer UID.
- **Circuit Breaker Compliant**: ✅ Enforces a standardized **Failure Signature** (1M+1 nodes) when search limits are exceeded.
- **Semantic Mapping**: ✅ Maps gRPC technical failures (`UNAVAILABLE`, `DEADLINE_EXCEEDED`) to user-friendly HTTP status codes (503/504).

## 2. Design

### 2.1 Architecture & Stack
- **Framework**: Express.js (v5) on Node.js 18+.
- **Communication**: gRPC / Protobuf (`@grpc/grpc-js`).
- **Context Management**: uses `AsyncLocalStorage` to consolidate logs from distributed layers (Cache, Database) into a single write operation.
### 2.2 Environmental Coordination
To prevent configuration poisoning, the Backend module adheres to the following environment rules:
- **MongoDB Atlas**: `MONGO_URI` is NEVER defined in `modules/backend/.env`. It is pulled from `modules/database/.env` or the root environment (Source of Truth).
- **gRPC Resolution**: `ROUTING_ENGINE_URL` must be explicitly defined in each environment to handle cross-container networking.
- **Search Optimization**: `SOC_DISCRETIZATION_STEP` (Default: 0.1) defines the kWh energy bin size for heuristic pruning. Lower values increase precision; higher values improve search speed.
- **Diagnostic Control**: (v2.3.0) `ALGO_KILL_TIME_MS` (Default: 60,000) and `ALGO_DEBUG_NODE_INTERVAL` (Default: 5,000) control the C++ Native Engine's internal logging and watchdog. `ENGINE_SIMULATOR` (Default: false) remains used for mock testing.
- **Search Hyperparameters**: (v2.3.0) `ALGO_MAX_NODES` (Default: 10,000,000), `ROUTING_EPSILON_MIN` (10.0), `ROUTING_IDA_BANDING_SHORTEST` (10.0), and `ROUTING_IDA_BANDING_FASTEST` (1.0).
- **Fail-Safe**: The `startServer` sequence must strictly check and log the URI type (e.g. `mongodb+srv://`) before opening the HTTP port.

### 2.3 Directory Structure
- `index.js`: Main entry point and lifecycle manager.
- `routes/routeApi.js`: Defines REST endpoints and controller registration.
- `controllers/calculateRoute.js`: Central logic for request validation and orchestration.
- `services/grpcClient.js`: gRPC connectivity and metadata injection.
- `services/evProfiles.js`: (NEW) Registry of high-fidelity OEM vehicle coefficients.
- `utils/validation.js`: (NEW) Joi-based schema validation for physical coefficients.
- `utils/context.js`: Shared request-buffer management.
- `utils/logger.js`: High-performance, disk-sync logging utility.
- `utils/uid.js`: Atomic request ID generator.

### 2.3 Data Models & API Contracts

#### POST `/api/routes/calculate`
- **Request Parameters**:
    - `start`, `end`: Geographic Lat/Lng objects.
    - `mock_hour`, `objective`: Traffic and weighting (Default 12, FASTEST).
    - **EV Strategy**:
        - `enabled`: Activates EV physics (Default false).
        - `vehicle_id`, `payload_kg`: Profile-based mass derivation.
        - `effective_mass_kg`, `start_soc_kwh`: Absolute mission overrides (Priority 1).
        - `drag_coeff`, `frontal_area_m2`, etc: Granular coefficient overrides.
        - `target_charge_bound_kwh`, `is_emergency_assumption`: Explicit synchronization overrides (v2.5.0).
- **Physics Priority**: 
    1. Absolute Mission Overrides (`effective_mass_kg`, `start_soc_kwh`).
    2. Selected Profile Coefficients (`vehicle_id`).
    3. System Defaults (`standard_ev`) for zero-configuration missions.
- **Response Schema**:
    - Returns a `success: true` envelope containing an array of algorithm results.
    - **EV Metrics**: Each result includes `arrival_soc_kwh`, `consumed_kwh`, and `is_charging_stop`.
    - **High-Fidelity Polyline**: Each coordinate in the `polyline` array includes `segment_consumed_kwh` (kWh).
    - **Standardized Failure Signature**: If an algorithm hits a circuit breaker (via `circuit_breaker_triggered: true` or exceeding `ALGO_MAX_NODES`), it returns:
        - `polyline: []`
        - `distance: 0`, `duration: 0`, `path_cost: 0`
        - `nodes_expanded`: `1,000,001`
        - `circuit_breaker_triggered: true`
        - `debug_logs`: Contains failure context (e.g., "Max nodes reached")

#### gRPC Orchestration Contract (v2.2.0)
- **Service**: `RouteService.CalculateRoute`
- **Method Signature (Node.js)**: `calculateRouteGrpc({ start, end, ...options })`
- **Metadata Injection**: 
    - `use-suite`: `true`
    - `log-dir`: Absolute path for Engine-side tracing.
    - `kill-time-ms`: (v2.3.0) Hard time-limit for search algorithms (Default: 60,000ms).
    - `debug-node-interval`: (v2.3.0) Interval for granular node tracing.
    - `max-nodes`: Absolute circuit breaker limit.
    - `algo-debug`: (v2.3.0) Replaces legacy tracing; strictly decoupled from application DEBUG.
    - `debug-mode`: General diagnostic verbosity toggle (Driven by `ENGINE_SIMULATOR`).
- **Response Transformation**:
    - Detect `(TRUNCATED: Native I/O...)` in `debug_logs`.
    - Mutate result to include: `\n\n Full trace available on-disk at: Output/<logDir>/Algo_<algorithm>.md`.
- **Error Mapping Strategy**:
    | gRPC Status Code | HTTP Status Code | Client Message |
    | :--- | :--- | :--- |
    | `DEADLINE_EXCEEDED` | `504` | Routing Engine Timeout (30s+). |
    | `UNAVAILABLE` | `503` | Routing Engine Unavailable. |
    | `INTERNAL` / Others | `500` | Internal Server Error. |
- **Payload Limits**: Manually set to **50MB** to handle massive urban road networks.

## 3. Verification

### 3.1 Automated Tests
- `node tests/main_test_runner.js`: Full-stack orchestration test.
- `npm test -- modules/backend`: Runs Express-level API contract tests.
- `npx eslint modules/backend`: Verifies adherence to the modular JavaScript pattern.

### 3.2 Manual Verification
- `http://localhost:3000/health`: Verifies service heartbeats.
- `Output/<UID>_...`: Confirms all request logs (Backend, Cache, Engine) are flushed to a single folder.

## 4. Maintenance (Quality Guardian)

### 4.1 Refactoring Policy
- **One Function Per File**: Controllers must be strictly separated from route definitions.
- **Async Hygiene**: All gRPC callbacks must be wrapped in Promises with `finally` cleanup triggers.
- **Linting Standards**: Strict single-quote and semicolon enforcement via `eslint.config.js`.

### 4.2 Quality Standards
- 100% adherence to the **Quality Guardian Protocol**.
- Continuous synchronization of `README.md` scenarios with current code behavior.
