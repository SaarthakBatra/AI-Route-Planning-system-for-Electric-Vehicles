# Backend Module Specification

## 1. Requirements

### User Stories
- As a frontend client, I need a reliable REST API to submit geographic coordinates and receive optimal route paths.
- As an architect, I need the backend to serve as an orchestration layer that interfaces with Redis (cache), MongoDB (telemetry), and the Python/C++ gRPC Routing Engine.

### Acceptance Criteria (Step 1: Tracer Bullet Complete)
- **Status**: ✅ VERIFIED
- An Express.js backend is operational in `modules/backend/`.
- Exposes a `POST` endpoint `/api/routes/calculate` for route requests.
- Implements a gRPC client to communicate with the Python Routing Engine on `localhost:50051`.
- Standardized error handling via `utils/errorResponse.js`.
- Universal debug logging via `utils/requestLogger.js` and `utils/logger.js`.
- Adheres to the "one function per file" principle for controllers.

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
- **Request**:
  ```json
  {
    "start": { "lat": 40.7128, "lng": -74.0060 },
    "end": { "lat": 40.7306, "lng": -73.9866 }
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "path": [
        { "lat": 40.7128, "lng": -74.0060 },
        { "lat": 40.7306, "lng": -73.9866 }
      ]
    }
  }
  ```

## 3. Verification
- **Unit Tests**: `tests/backend/calculateRoute.test.js` (using Jest and Supertest).
- **Manual Verification**: `http://localhost:3000/health` returns `{"status":"UP"}`.

