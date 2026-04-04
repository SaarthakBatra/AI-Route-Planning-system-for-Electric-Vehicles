# Backend Module Specification

## 1. Requirements

### 1.1 User Stories
- As a frontend client, I need a reliable REST API to submit geographic coordinates and receive optimal route paths.
- As an architect, I need the backend to serve as an orchestration layer that interfaces with Redis (cache), MongoDB (telemetry), and the Python/C++ gRPC Routing Engine.

### 1.2 Design Principles
- **Orchestration Only**: The backend must never execute business logic or pathfinding; it strictly delegates to microservices.
- **Context Preservation**: Use `AsyncLocalStorage` to maintain an atomic log buffer per request.
- **Standardized Headers**: Quality Guardian compliant headers for maintenance and traceability.
- **Fail-Safe Operation**: Implement fallback strategies for cache and engine unavailability.

### 1.3 Acceptance Criteria
- **City-Scale Orchestration**: ✅ Manages 50MB+ OSM payloads without blocking the main thread.
- **Bounding Box Precision**: ✅ Calculates geographical search zones with 4-decimal quantization for cache hits.
- **Atomic UID**: ✅ Every request is uniquely identifiable via an incremental integer UID.
- **Circuit Breaker Compliant**: ✅ Forwards gRPC metadata to the Engine to enforce per-request node limits.

## 2. Design

### 2.1 Architecture & Stack
- **Framework**: Express.js (v5) on Node.js 18+.
- **Communication**: gRPC / Protobuf (`@grpc/grpc-js`).
- **Context Management**: uses `AsyncLocalStorage` to consolidate logs from distributed layers (Cache, Database) into a single write operation.
- **Target Resolution**: Dynamically resolved via `ROUTING_ENGINE_URL` environment variable.

### 2.2 Directory Structure
- `index.js`: Main entry point and lifecycle manager.
- `routes/routeApi.js`: Defines REST endpoints and controller registration.
- `controllers/calculateRoute.js`: Central logic for request validation and orchestration.
- `services/grpcClient.js`: gRPC connectivity and metadata injection.
- `utils/context.js`: Shared request-buffer management.
- `utils/logger.js`: High-performance, disk-sync logging utility.
- `utils/uid.js`: Atomic request ID generator.

### 2.3 Data Models & API Contracts

#### POST `/api/routes/calculate`
- **Request Parameters**:
    - `start`, `end`: Geographic Lat/Lng objects.
    - `mock_hour`: 0-23 (Integer).
    - `objective`: "FASTEST" | "SHORTEST".
- **Response Schema**:
    - Returns a `success: true` envelope containing an array of 5 algorithm results with path polylines and cost metrics.

#### gRPC Orchestration Contract
- **Service**: `RouteService.CalculateRoute`
- **Metadata**: 
    - `use-suite`: `true`
    - `log-dir`: Absolute path for Engine-side tracing.
- **Payload Limits**: Manually set to **100MB** to handle massive urban road networks.

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
