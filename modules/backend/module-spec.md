# Backend Module Specification

## 1. Requirements

### User Stories
- As a frontend client, I need a reliable REST API to submit geographic coordinates and receive optimal route paths.
- As an architect, I need the backend to serve as an orchestration layer that interfaces with Redis (cache), MongoDB (telemetry), and the Python/C++ gRPC Routing Engine without carrying complex pathfinding business logic itself.

### Acceptance Criteria (Step 1: Tracer Bullet)
- An Express.js backend is scaffolding in `modules/backend/`.
- The backend successfully runs and exposes a POST endpoint `/api/routes/calculate`.
- The endpoint accepts a JSON payload containing `start` and `end` coordinates.
- For this initial step, the backend responds properly with dummy data so the frontend can validate end-to-end connectivity.
- Code style adheres to the global rules: strict JSDoc, graceful error handling wrapping (no crash), standardized error responses, and the "one function per file" principle.

## 2. Design

### Architecture & Stack
- **Runtime Environment**: Node.js
- **Web Framework**: Express.js
- **Scale Strategy (Future)**: Node clusters/workers handling concurrent connections.
- **Directory Structure**:
  - `index.js` - Server entry point, orchestration, and route registration (NO business logic allowed).
  - `routes/` - Express sub-routers grouping endpoints.
  - `controllers/` - HTTP request validation and response formatting. (One function per file).
  - `services/` - Integration with external modules (gRPC client, Redis client).
  - `utils/` - Shared utilities like centralized logging or standardized error formatters.

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

## 3. Implementation Tasks (Step 1)
1. Initialize Node project in `modules/backend/` and install `express` and `cors`.
2. Create `modules/backend/README.md` for onboarding.
3. Setup `modules/backend/utils/errorResponse.js` and `modules/backend/utils/logger.js`.
4. Create `modules/backend/index.js` to setup standard Express routing.
5. Create `modules/backend/routes/routeApi.js`.
6. Create `modules/backend/controllers/calculateRoute.js` to handle dummy response for Step 1 pipeline validation.
