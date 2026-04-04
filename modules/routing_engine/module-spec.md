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
- **Circuit Breaker**: ✅ Enforces `ROUTING_MAX_NODES` expansion limit to prevent CPU/memory exhaustion.
- **Precision Banding**: ✅ Prevents search stagnation on fractional cost edges via Epsilon bucketing.

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
- `map_data`: Optional stringified OSM JSON from the cache layer.

#### Metadata Configuration
- `max-nodes` (String): Overrides `ROUTING_MAX_NODES`.
- `algo-debug` (String): Enables step-by-step Markdown tracing in `Output/`.
- `debug-mode` (String): Triggers the Stage 1 legacy square tracer.

### Robustness Features
- **Island Detection BFS**: Aborts suite instantly if start/end belong to disconnected components.
- **IDA* Precision Banding**: Configurable `banding_shortest` (meters) and `banding_fastest` (seconds) thresholds.
- **IDDFS Epsilon Scaling**: Hard minimum jump for iterative lengthening to prevent infinite sub-millimeter progression.

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
