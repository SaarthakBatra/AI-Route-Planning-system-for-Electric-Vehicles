# Cache Module — AI Route Planner

The Cache module provides a high-performance in-memory data layer using **Redis/Valkey**. It serves two primary functions:
1. **Route Calculation Caching**: Storing computed paths to avoid expensive re-calculation.
2. **Dynamic Map Ingestion (OSM Worker)**: Ingesting and caching OpenStreetMap data for dynamic bounding boxes, enabling transit from static graphs to real-world geography.

---

## 🧠 What is Redis/Valkey?

**Redis** (and its compatible fork **Valkey**) is an open-source, in-memory data structure store. Unlike traditional databases (like MongoDB) that write to disk, Redis stores data in RAM, offering sub-millisecond latency.

### Role in our System:
- **Efficiency**: Prevents the "15-second OSM API delay" by storing map segments locally.
- **Concurrency**: Manages hundreds of simultaneous requests without spiking CPU.
- **LRU Management**: Automatically prunes old data to stay within memory limits.

---

## 🚀 Operational Guide

### Starting the Service (Linux/Development)
The system expects Redis/Valkey to be running on `127.0.0.1:6379`.

#### Method 1: System Service (Recommended)
Use this if the service is installed globally:
```bash
# Start the service
sudo systemctl start valkey   # If using Valkey
# OR
sudo systemctl start redis    # If using standard Redis
```

#### Method 2: Manual Binary Execution
Use this if you don't have a system service configured or are in a restricted environment:
```bash
redis-server --daemonize yes
```

#### Method 3: Docker
```bash
docker run -d --name cache-layer -p 6379:6379 valkey/valkey:8
```

### Verification
Always verify connectivity before the backend starts:
```bash
redis-cli ping   # Should return PONG
node modules/cache/index.js  # Runs module-specific health checks
```

---

## 📂 Architecture & OSM Ingestion

### Dynamic Worker (`services/osmWorker.js`)
When the backend requests a route, the Cache module:
1. **Quantizes**: Rounds coordinates to 4 decimals (~11m precision) to generate a stable key.
2. **Checks Cache**: Returns JSON data immediately if available.
3. **Ingests**: Fetches from the Overpass API using native `fetch` if the data is missing.
4. **Prunes**: If the cache exceeds `MAX_CACHE_ENTRIES` (default 1000), it removes the **Least Recently Used (LRU)** entry using a Redis Sorted Set Metadata tracker.

---

## 🤖 Agent Integration Guide

For **Backend** or **Routing Engine** agents: use the following contract to fetch road network data.

```javascript
const { getMapData } = require('../cache/services/osmWorker');

// Trigger ingestion for a specific search area
const mapData = await getMapData({
  minLat: 51.500,
  minLon: -0.100,
  maxLat: 51.501,
  maxLon: -0.099
});
```

---

## 🏭 Production Considerations

When moving from local development to production, the following changes are required:

1. **Security**:
   - **Password Authentication**: Set `REDIS_PASSWORD` in `.env`.
   - **TLS/SSL**: Enable encrypted connections if the cache is hosted on a managed service (e.g., Redis Cloud, AWS ElastiCache).
2. **Persistence**:
   - Local dev uses "In-Memory Only". 
   - Production may require **AOF (Append Only File)** or **RDB snapshots** to ensure the cache survives a restart.
3. **Scale**:
   - For high-availability, transition from a single instance to a **Redis Cluster** or **Sentinel** setup.
4. **Environment Variables**:
   - Ensure `MAX_CACHE_ENTRIES` is tuned based on the available RAM of the production server.

---

## 🛠️ Tech Stack & Tests
- **Node.js** (v18+)
- **ioredis** (Client)
- **Jest** (Unit testing with absolute mocks)

**Run tests**: `npm test -- ../../tests/cache/osmWorker.test.js`
