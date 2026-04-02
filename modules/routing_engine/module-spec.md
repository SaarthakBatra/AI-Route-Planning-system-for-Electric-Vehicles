# Routing Engine Module Specification

## 1. Requirements

### User Stories
- As a backend orchestrator, I need a high-performance routing module to compute optimal paths based on complex constraints.
- As a developer, I need clear visibility into the data flow across the Python/C++ boundary.

### Acceptance Criteria (Step 1: Tracer Bullet Complete)
- **Status**: ✅ VERIFIED
- Hybrid architecture implemented: Python gRPC server + C++ `pybind11` core.
- `CalculatedRoute` gRPC method successfully bridges to the C++ engine.
- Every function call across the boundary is logged with `[DEBUG]` prefixes.
- C++ core validates mathematical inputs and returns hardcoded polyline data for validation.
- Automated `pytest` suite confirms gRPC and C++ integration.

### Acceptance Criteria (Step 3: Academic Search Suite & L3 Complexity)
- **Status**: ✅ VERIFIED
- Comprehensive Search Suite: BFS, Dijkstra, IDDFS, A*, and IDA* implemented in C++.
- Heuristic Functions: $h_d(n)$ (Haversine) and $h_t(n)$ (Temporal) implemented to support informed searches.
- L3 Mock Traffic: Dynamic edge cost calculation using road-type multipliers (1.5x for primary, 2.0x for secondary during peak hours) based on `mock_hour`.
- Multi-threaded Concurrency: All 5 algorithms execute in parallel via `std::async`, utilizing multi-core architecture for zero-latency comparison.
- gRPC Performance Metrics: Every search returns `nodes_expanded`, `exec_time_ms`, and `path_cost` for academic benchmarking.
- Robust Backward Compatibility: `debug-mode: true` (metadata or env) successfully triggers the Stage 1 legacy Tracer Bullet.
- Automated Verification: `pytest` suite confirms deterministic results for traffic impact and objective optimization (Fastest vs Shortest).

## 2. Design

### Architecture & Tech Stack
- **Languages**: Python 3.x (Server/Orchestration), C++ 17 (Mathematical Engine).
- **Bridge**: `pybind11` for high-performance STL container mapping (std::vector, std::pair).
- **API**: gRPC / Protobuf (`route_engine.proto`).
- **Build**: `setuptools` driven C++ extension compilation (`route_core.so`).
- **Algorithm Strategy**: Dijkstra's algorithm with a `std::priority_queue` min-heap.

### Technical Implementation Details (Stage 3)

#### Search Algorithm Strategy
- **Uninformed**: BFS (Queue), Dijkstra (Min-Priority Queue), IDDFS (Recursive DFS with Depth Limits).
- **Informed**: A* (Priority Queue + $g(n)+h(n)$), IDA* (Iterative Deepening A* with threshold pruning).
- **Efficiency**: Parallelization via `std::async` to utilize multi-core architecture.

#### Heuristics and Cost Functions
- **Distance Heuristic ($h_d$)**: Haversine distance from node $n$ to goal $T$.
- **Temporal Heuristic ($h_t$)**: $h_d(n) / \text{max\_legal\_speed}$.
- **Cost Function ($g(n)$)**: Sum of edge weights (distance or duration).
- **Traffic Multiplier**: Applied to edge duration based on `mock_hour` (e.g., peak 8-10 AM).

#### Algorithm Selection Hierarchy
To ensure robust testing and backward compatibility, the server implements a priority-based selection for the routing algorithm:
1. **gRPC Metadata**: `debug-mode: true` -> Legacy Dummy Tracer. 
2. **Environment Variable**: `DEBUG_MODE=true` -> Legacy Dummy Tracer.
3. **Default**: Execute 5 Parallel Academic Algorithms.

#### Coordinate Snapping
The `find_nearest_node` function uses the Haversine formula to compute distances between arbitrary input coordinates and all nodes in the `STATIC_NODES` array, snapping the request to the closest graph entrance/exit.

### Directory Structure
- `server.py`: gRPC service implementation and Python entry point.
- `core/engine.cpp`: High-performance C++ calculation logic.
- `proto/`: Protobuf definitions and generated code.
- `setup.py`: Build configuration for the C++ extension.

### API Contract (`route_engine.proto`)
```proto
enum Objective {
    FASTEST = 0;
    SHORTEST = 1;
}

message Coordinate {
    double lat = 1;
    double lng = 2;
}

message RouteRequest {
    Coordinate start = 1;
    Coordinate end = 2;
    int32 mock_hour = 3;
    Objective objective = 4;
}

message AlgorithmResult {
    string algorithm = 1;
    repeated Coordinate polyline = 2;
    double distance = 3;
    double duration = 4;
    int32 nodes_expanded = 5;
    double exec_time_ms = 6;
    double path_cost = 7;
}

message RouteResponse {
    repeated AlgorithmResult results = 1;
}

service RouteService {
    rpc CalculateRoute (RouteRequest) returns (RouteResponse) {}
}
```

## 3. Verification
- **Automated Tests**: `pytest` in `tests/routing_engine/test_server.py`.
- **Manual Verification**: Launch `python server.py` and verify "Listening on port 50051".

