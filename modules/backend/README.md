# Backend Module

The Backend module serves as the central orchestration layer for the AI Route Planner. It exposes a RESTful API to the frontend and interfaces with specialized microservices via gRPC and standard protocols.

## 🚀 Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env`:
   ```env
   PORT=3000
   DEBUG=true
   ```
3. Run in development:
   ```bash
   npm run dev
   ```

## 🏗️ Architecture

```mermaid
graph TD
    A[Frontend] -- POST /api/routes/calculate --> B[Backend Express]
    B -- gRPC --> C[Routing Engine]
    B -- ioredis --> D[Cache]
    B -- Mongoose --> E[Database]
```

- **Orchestration**: Manages the flow between data interfaces and the core engine.
- **Validation**: Ensures incoming coordinate requests are sanitized and valid.
- **Logging**: Comprehensive request/response tracing for debugging.

## 🛠️ Tech Stack
- **Node.js**: Asynchronous runtime.
- **Express.js**: Web framework.
- **gRPC**: High-performance communication with the Routing Engine.
- **Jest**: Unit and integration testing.

## 🧪 Testing
Run tests from the module directory:
```bash
npm test
```
Or target specific files:
```bash
npm test -- ../../tests/backend/calculateRoute.test.js
```
## Design Rules
- Centralized Try/Catch wrappers around every router method.
- Standardized REST JSON errors `{ error: true, code: XXX, message: "..." }`.

*Refer to `module-spec.md` for full implementation boundaries.*
