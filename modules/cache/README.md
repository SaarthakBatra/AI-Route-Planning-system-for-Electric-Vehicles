# Cache Module

The Cache module provides a high-performance Redis interface for storing and retrieving computed routes, optimizing system response times and reducing load on the Routing Engine.

## 🚀 Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env`:
   ```env
   REDIS_HOST=127.0.0.1
   REDIS_PORT=6379
   DEBUG=true
   ```
3. Run health check:
   ```bash
   node index.js
   ```

## 🏗️ Architecture

- **Client**: Uses `ioredis` with `lazyConnect` and `maxRetriesPerRequest` for stability.
- **Monitoring**: Built-in listeners for connection health.
- **Diagnostics**: Standalone `index.js` for verifying connectivity without the full backend.

## 🛠️ Tech Stack
- **Node.js**: Runtime.
- **ioredis**: Feature-rich Redis client.
- **Jest**: Unit testing with mocking.

## Prerequisites
- **Node.js** v18+
- **Redis** v7+ running locally (default: `127.0.0.1:6379`)
  - Install: `sudo apt install redis-server` (Ubuntu/Debian) or via Docker: `docker run -d -p 6379:6379 redis:7`

## Environment Setup
Copy the `.env` defaults and adjust if your Redis is not on localhost:
```
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
DEBUG=true
```

## Installation
```bash
cd modules/cache
npm install
```

## Running the Health Check
```bash
node index.js
```
Expected output:
```
[CACHE] [INFO]  Initializing Redis client | host: 127.0.0.1:6379
[CACHE] [INFO]  Redis client connected     | host: 127.0.0.1:6379
[CACHE] [INFO]  Redis client ready         | host: 127.0.0.1:6379
[CACHE] [CALL] pingRedis | input: none
[CACHE] [INFO]  Redis PING response: PONG
[CACHE] [DONE] pingRedis | output: PONG
[CACHE] [INFO]  Health check complete. Disconnecting from Redis...
[CACHE] [INFO]  Redis disconnected cleanly.
```

## Running Tests
Tests are mocked — no live Redis required:
```bash
npm test
```

## Module Structure
```
modules/cache/
├── .env                    # Environment configuration
├── package.json
├── index.js                # Health-check entry point
├── module-spec.md          # Module specification and architecture
├── services/
│   └── redisClient.js      # ioredis client + pingRedis()
└── utils/
    └── logger.js           # [CACHE]-prefixed logger with CALL/DONE tracing
```
