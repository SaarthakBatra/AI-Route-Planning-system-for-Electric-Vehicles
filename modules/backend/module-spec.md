# Backend Module Specification

## 1. Requirements

### User Stories
- As a frontend client, I need a reliable REST API to submit geographic coordinates and receive optimal route paths.
- As an architect, I need the backend to serve as an orchestration layer that interfaces with Redis (cache), MongoDB (telemetry), and the Python/C++ gRPC Routing Engine.

- Adheres to the "one function per file" principle for controllers.

### Acceptance Criteria (Step 3: Academic Search Suite)
- **Status**: 🟢 COMPLETE (Step 3 Implementation)
- **Multi-Algorithm Support**: API returns 5 results (BFS, Dijkstra, IDDFS, A*, IDA*) in a comparative `results` array.
- **L3 Complexity**: Supports `mock_hour` (traffic weighting) and `objective` (optimization target).
- **Metric Transparency**: Every result includes performance telemetry (nodes, latency, path cost).
- **Communication Protocol**: gRPC orchestration with `use-suite: true` metadata.
- **Integration**: Backend unit tests cover parameter validation and gRPC error handling.

## 2. Design

### Architecture & Stack
- **Runtime**: Node.js
- **Framework**: Express.js (v5)
- **Communication**: gRPC (via `@grpc/grpc-js`)
- **Logging**: Console-based with `DEBUG=true` toggle.

### Directory Structure
- `index.js`: Server entry point and middleware registration.
- `routes/routeApi.js`: Defines the API routes.
- `controllers/calculateRoute.js`: Handles request validation and gRPC orchestration.
- `services/grpcClient.js`: Manages the gRPC connection to the Routing Engine.
- `utils/`: Shared utilities for logging and error responses.

### Data Models & API Contracts

**POST `/api/routes/calculate`**
- **Request Parameters**:
    - `start` (Object, Required): `{ lat: number, lng: number }`.
    - `end` (Object, Required): `{ lat: number, lng: number }`.
    - `mock_hour` (Number, Optional): Range `0-23`. Defaults to `12`. Used by Engine to apply L3 traffic multipliers.
    - `objective` (String, Optional): `"FASTEST"` or `"SHORTEST"`. Defaults to `"FASTEST"`.
- **Response Schema**:
  ```json
  {
    "success": true,
    "data": {
      "results": [
        {
          "algorithm": "BFS",             // Search variant used
          "polyline": [ { "lat": ..., "lng": ... }, ... ],
          "distance": 1250,               // Path distance in meters
          "duration": 450,                // Travel time in seconds (L3-adjusted)
          "nodes_expanded": 84,           // Academic performance metric
          "exec_time_ms": 0.45,           // Engine-side latency
          "path_cost": 1250               // Internal algorithm evaluation cost
        }
      ]
    }
  }
  ```

### gRPC Orchestration Contract
- **Service**: `RouteService.CalculateRoute`
- **Metadata**: Add `use-suite: true` to trigger the search suite.
- **Payload**: Maps JSON request fields directly to the `RouteRequest` proto message.

## 3. Verification
- **Unit Tests**: `tests/backend/calculateRoute.test.js` (using Jest and Supertest).
- **Manual Verification**: `http://localhost:3000/health` returns `{"status":"UP"}`.

