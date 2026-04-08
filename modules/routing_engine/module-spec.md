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
- **Multi-Objective EV Routing**: ✅ (v2.1.0) Implements RCSPP with Energy/Time Pareto fronts, regenerative braking, and thermal pre-conditioning.
- **Enhanced Traceability**: ✅ (v2.1.1) Standardized 'Unnamed Node' fallbacks and explicit SoC-pruning traces for high-fidelity EV missions.
- **Metadata-Driven Orchestration**: ✅ (v2.1.2) Fully de-coupled engine from local `.env`; all hyperparameters and the heartbeat interval (`log-flush-interval`) are injected via gRPC metadata.
- **Zero-Context Hardening**: ✅ (v2.2.0) Strictly enforces metadata-only parameterization within the request context; logs `DEBUG` diagnostic warnings for system-level fallbacks. Verified via automated heartbeat tests.
- **Native Watchdog & Direct I/O**: ✅ (v2.3.0) Migrated diagnostic logging and search lifecycle management to a fully native C++ implementation. Features a high-precision `Steady Clock` watchdog and direct-to-disk `std::ofstream` streaming, eliminating Python GIL bottlenecks and OOM risks.
- **EV Charging Expansion & Regenerative Tracking**: ✅ (v2.5.0) Implements actual charging stops in Pareto state-space, forcing A*/Dijkstra/BFS to find valid charging routes. Exposes segment-level energy consumption for frontend visualization. Automatically bypasses IDDFS/IDA* for EV missions to prevent state-space explosion.

## 2. Design

### Architecture & Stack
- **Languages**: Python 3.8+ (Server/Orchestration), C++17 (Mathematical Engine).
- **Binding**: `pybind11` with `gil_scoped_release` for non-blocking concurrent search execution.
- **Communication**: gRPC / Protobuf (`route_engine.proto`).
- **Context Management**: Direct-to-disk diagnostic streaming using `std::ofstream`.

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
- `region_id`: Geographic region identifier used as the C++ Graph Cache key.
- `map_data_pb`: Binary-serialized `MapPayload` message for high-speed ingestion.
- `map_data`: DEPRECATED. Optional stringified OSM JSON from the cache layer.
- `ev_params`: NEW (v2.1.0) Physics coefficients, mass, SoC thresholds, and charging limits.

#### EV Configuration (`EVParams`)
- `effective_mass_kg`: Tare mass + payload weight.
- `Crr`, `wheel_radius_m`: Rolling resistance and tire geometry.
- `ac_kw_max`, `dc_kw_max`: On-board and DC fast chargers limits.
- `max_regen_power_kw`: Battery regeneration intake limit.
- `energy_uncertainty_margin_pct`: Safety buffer applied to consumption.
- `start_soc_kwh`, `min_waypoint_soc_kwh`, `min_arrival_soc_kwh`: Multi-layer reserve thresholds.

#### Node Binary Schema (`NodeProto`)
- `id`, `lat`, `lng`, `name`: Basic topology.
- `elevation`, `elevation_confidence`: Detailed 3D topography.
- `is_charger`, `charger_type`: EV Charging POI visibility.
- `kw_output`, `is_operational`: Power availability and real-time status.
- `available_ports`: Repeated enum (CCS2, CHADEMO, IEC_T2, etc.).
- `is_emergency_assumption`: Indicator for untrusted wall-plug nodes.

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
| `ROUTING_LOG_INTERVAL` | `250000` | Frequency of node expansion progress logging (deprecated/fallback). |
| `SOC_DISCRETIZATION_STEP` | `0.1` | SoC binning step (kWh) using strict Int-based Pareto mapping `(int, double)` to prevent state-space explosion. |
| `ROUTING_EPSILON_MIN` | `10.0` | Min cost jump for IDDFS. |

### Robustness Features
- **Island Detection BFS**: Aborts suite instantly if start/end belong to disconnected components.
- **IDA* Precision Banding**: Configurable `banding_shortest` (meters) and `banding_fastest` (seconds) thresholds.
- **IDDFS Epsilon Scaling**: Hard minimum jump for iterative lengthening to prevent infinite sub-millimeter progression.
- `IDA* Dynamic Pruning`: (v2.0.1) Pass 2 now uses `max(30.0, max_speed * 0.5)` for aggressive pruning, eliminating hardcoded fallbacks.
- `Iterative Adaptive Banding`: (v2.0.2) Thresholding now uses `jump = max(banding_val, (min_val - threshold) * 1.5)` to skip redundant layers.
- `Diagnostic Invisibility Fix`: (v2.0.3) gRPC `AlgorithmResult` now includes `debug_logs` (string) and `circuit_breaker_triggered` (bool) for absolute search transparency.

### Search Optimization (v2.4.0)
- **Int-Based Pareto Mapping**: All multi-objective search algorithms (BFS, Dijkstra, IDDFS, A*, IDA*) employ strict integer binning for State-of-Charge (SoC) tracking within the Pareto `fronts`. This rigidly enforces state-space pruning by mapping continuous energy math to discrete `(int soc_bin, double cost)` buckets, effectively collapsing the frontier against floating-point math jitter.
- **Domination Logic**: A state is dominated if an existing state has equal or better SoC bin AND equal or better cost. Obsolescence sweeping ensures that redundant, less-efficient states are removed from memory.

## 3. Verification

### Automated Tests
- `pytest tests/routing_engine/test_server.py`: Validates connectivity, metrics, and island detection.
- `pytest tests/routing_engine/test_ev_functionality.py`: NEW (v2.1.0) Verifies 3D energy physics and SoC pruning.
- `flake8 modules/routing_engine/server.py`: Enforces zero-violation PEP8 compliance.

### Manual Verification
- `ALGO_DEBUG=true python server.py` and verify `.md` files in `Output/Algorithm_logs/`.
- Verify `route_core.so` presence after running `python setup.py build_ext --inplace`.

## 4. Maintenance (Quality Guardian)

### Refactoring Policy
- **Mathematical Core Monolith**: The search algorithms are maintained within a high-performance C++ monolith (`engine.cpp`) to minimize memory fragmentation and preserve pointer-chasing efficiency during edge relaxation.
- **Native Diagnostic Sinking**: All diagnostic traces are streamed directly to hardware via `std::ofstream` using a per-node buffer and a periodic `flush()` mechanism to maintain a near-zero RAM footprint.

### Quality Standards
- 100% PEP8 compliance for Python orchestration.
- Doxygen-standard documentation for all C++ algorithm implementations.

## 5. Logging & Diagnostics

The engine implements high-fidelity diagnostic tracing when `ALGO_DEBUG=true` is enabled. 

### 5.1 Granular Step-by-Step Tracing (v2.1.2)
Algorithms emit a markdown-compatible trace for EVERY node expansion:
```markdown
### Step [N]: Expanding Node [ID] ([Name])
- Queue Size: [Size]
  - Added neighbor: [Neighbor ID] ([Name])
```
This is used to identify state-space local-minima and "stuck" search frontiers.

### 5.2 Failure Signatures
- **Search Termination**: `circuit_breaker_triggered = true`
- **Standard Fault Response**: 0 cost, 0 distance, empty polyline.
 (Meters)
