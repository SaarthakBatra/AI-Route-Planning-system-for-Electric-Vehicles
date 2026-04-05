# Routing Engine Module Specification

## 1. Requirements

### User Stories
- As a backend orchestrator, I need a high-performance routing module to compute optimal paths based on complex geographic and temporal constraints.
- As a developer, I need deep algorithmic traceability (tracing) to debug search-space pathologies in Iterative Deepening algorithms.

### Design Principles
- **Memory Efficiency**: Use transposition tables and stack-based iterative depth-first search to handle large-scale graphs with limited RAM.
- **Academic Comparison**: Return results for 5 distinct algorithms in parallel to allow for performance benchmarking.
- **Thread Isolation**: Instantiate a localized `Graph` object per-request to ensure thread safety across concurrent gRPC calls.

### Acceptance Criteria (v1.1.0 Compliance)
- **Parallel Optimization**: ✅ Executes 5 algorithms concurrently utilizing all available CPU cores via `std::async`.
- **Dynamic Ingestion**: ✅ Parses OSM JSON elements with $O(1)$ constant-time node lookup logic.
- **Island Detection**: ✅ Implements pre-search BFS to verify connectivity between start/end points.
- **Circuit Breaker**: ✅ Enforced across all IDA* passes; Pass 2 short-circuited if Pass 1 triggers limit.
- **Iterative Adaptive Banding**: ✅ (v2.0.2) Replaced static thresholding with Geometric Growth (1.5x overshoot) for logarithmic convergence on large map datasets.

### Acceptance Criteria (v2.0.0 Compliance)
- **Graph Cache Persistence**: ✅ Thread-safe C++ LRU cache persists `Graph` structs by `region_id` across gRPC calls, eliminating $O(V+E)$ rebuild on cache hits.
- **Protobuf Binary Ingestion**: ✅ `bytes map_data_pb` field accepted; `ParseFromString()` replaces `json.loads()` on the fast path.
- **Improved Performance**: ✅ Reduced memory allocation pressure by reusing graph topology in memory.
- **Backward Compatibility**: ✅ @deprecated `string map_data` fallback path maintained; produces identical results with a warning.
- **Bi-Directional Restoration**: ✅ Restored 1:1 edge parity in Protobuf ingestion (v2.0.1) to ensure optimal pathing on asymmetric data.
- **Failure Signature**: ✅ (v2.0.4) Implemented standardized node-expansion limit mapping (nodes_expanded = MAX+1) for frontend diagnostics.

## 2. Design

### Architecture & Stack
- **Languages**: Python 3.8+ (Server/Orchestration), C++17 (Mathematical Engine).
- **Binding**: `pybind11` for direct memory mapping of STL containers (vector, map).
- **Communication**: gRPC / Protobuf (`route_engine.proto`).
- **Context Management**: Buffered `active_requests` dictionary with synchronized log flushing.

### Directory Structure
- `server.py`: gRPC service implementation and log synchronization.
- `core/engine.cpp`: Mathematical core containing all 5 search algorithms.
- `core/binding.cpp`: Pybind11 registration and struct mapping.
- `proto/`: Protobuf definition files and generated Python stubs.
- `setup.py`: Build configuration for the `route_core` C++ extension.

### Data Models & API Contracts

#### gRPC Request (`RouteRequest`)
- `start`, `end`: `LatLng` coordinates.
- `objective`: Enum (0: FASTEST, 1: SHORTEST).
- `mock_hour`: Simulated time (0-23) for traffic scaling.
- `region_id`: NEW. Geographic region identifier used as the C++ Graph Cache key.
- `map_data_pb`: NEW. Binary-serialized `MapPayload` message for high-speed ingestion.
- `map_data`: DEPRECATED. Optional stringified OSM JSON from the cache layer.

#### Map Binary Schema (`MapPayload`)
- `nodes`: List of `NodeProto` (ID, Lat, Lng, Name).
- `edges`: List of `EdgeProto` (U, V, Weight, Speed, RoadType).

#### Metadata Configuration
- `max-nodes` (String): Overrides `ROUTING_MAX_NODES`.
- `algo-debug` (String): Enables step-by-step Markdown tracing in `Output/`.
- `debug-mode` (String): Triggers the Stage 1 legacy square tracer.
- `cache-evict` (String): If "true", clears the entire C++ graph cache.

#### Performance & Latency Targets
- **Cache Hit Latency**: < 50ms (Graph retrieval + Nearest node lookup).
- **In-Memory Build**: < 400ms (Protobuf parse + Component labeling for 50k elements).
- **Search Throughput**: 5 parallel searches in < 300ms on NH-52 static corridor.
- **Memory Efficiency**: < 15MB overhead per 10k nodes in LRU cache.

#### Environment Variables
| Variable | Default | Purpose |
|---|---|---|
| `GRAPH_CACHE_MAX_SIZE` | `20` | Max number of cached Graph regions before LRU eviction. |
| `ROUTING_MAX_NODES` | `1000000` | Hard limit on node expansions per search. |
| `ROUTING_EPSILON_MIN` | `10.0` | Min cost jump for IDDFS. |

### Robustness Features
- **Island Detection BFS**: Aborts suite instantly if start/end belong to disconnected components.
- **IDA* Precision Banding**: Configurable `banding_shortest` (meters) and `banding_fastest` (seconds) thresholds.
- **IDDFS Epsilon Scaling**: Hard minimum jump for iterative lengthening to prevent infinite sub-millimeter progression.
- `IDA* Dynamic Pruning`: (v2.0.1) Pass 2 now uses `max(30.0, max_speed * 0.5)` for aggressive pruning, eliminating hardcoded fallbacks.
- `Iterative Adaptive Banding`: (v2.0.2) Thresholding now uses `jump = max(banding_val, (min_val - threshold) * 1.5)` to skip redundant layers.
- `Diagnostic Invisibility Fix`: (v2.0.3) gRPC `AlgorithmResult` now includes `debug_logs` (string) and `circuit_breaker_triggered` (bool) for absolute search transparency.

## 3. Verification

### Automated Tests
- `pytest tests/routing_engine/test_server.py`: Validates connectivity, metrics, and island detection.
- `flake8 modules/routing_engine/server.py`: Enforces zero-violation PEP8 compliance.

### Manual Verification
- `ALGO_DEBUG=true python server.py` and verify `.md` files in `Output/Algorithm_logs/`.
- Verify `route_core.so` presence after running `python setup.py build_ext --inplace`.

## 4. Maintenance (Quality Guardian)

### Refactoring Policy
- **Mathematical Core Monolith**: The search algorithms are maintained within a high-performance C++ monolith (`engine.cpp`) to minimize memory fragmentation and preserve pointer-chasing efficiency during edge relaxation.
- **Log Atomic Writing**: All output must be persistent via the `write_md_log_buffer` utility to ensure zero log data loss during SIGTERM events.

### Quality Standards
- 100% PEP8 compliance for Python orchestration.
- Doxygen-standard documentation for all C++ algorithm implementations.
 (Meters)
