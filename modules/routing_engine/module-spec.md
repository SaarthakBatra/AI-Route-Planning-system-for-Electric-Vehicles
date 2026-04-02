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

### Acceptance Criteria (Step 2: Classical Routing & Static Mapping)
- **Status**: ✅ VERIFIED
- Self-written Dijkstra algorithm (C++, std::priority_queue) implemented on a 26-node static graph.
- Supports 3 primary corridors between Pilani (28.3623, 75.6042) and Jaipur (26.9784, 75.7122).
- Edge weights based on official MoRTH speed limits (100 km/h for trunks, 70/60 km/h for state highways).
- Nearest-node snapping (Haversine) implemented for arbitrary lat/lng inputs.
- Preserves Stage 1 functionality via the `use-real-algo` gRPC metadata and `USE_REAL_ALGO` env toggle.
- `CalculatedRoute` gRPC call returns real distance, duration, and path coordinates.

## 2. Design

### Architecture & Tech Stack
- **Languages**: Python 3.x (Server/Orchestration), C++ 17 (Mathematical Engine).
- **Bridge**: `pybind11` for high-performance STL container mapping (std::vector, std::pair).
- **API**: gRPC / Protobuf (`route_engine.proto`).
- **Build**: `setuptools` driven C++ extension compilation (`route_core.so`).
- **Algorithm Strategy**: Dijkstra's algorithm with a `std::priority_queue` min-heap.

### Technical Implementation Details (Stage 2)

#### Dijkstra Implementation
- **Data Structures**: Uses an adjacency list of `Edge` structs.
- **Priority Queue**: `std::priority_queue<std::pair<double, int>, std::vector<std::pair<double, int>>, std::compare_dist>` where `double` is the cumulative cost (distance/duration) and `int` is the node ID.
- **Path Reconstruction**: Maintains a `prev[]` array to backtrack from the destination node to the source.
- **Efficiency**: Algorithm runs in $O(E \log V)$ time.

#### Static Graph Topology
The graph covers 26 major junctions across 3 corridors:
1. **NH-52 Corridor (Sikar Route)**: Pilani → Chirawa → Jhunjhunu → Sikar → Ringus → Chomu → Jaipur.
2. **NH-11/NH-48 Corridor (Narnaul Route)**: Pilani → Chirawa → Narnaul → Kotputli → Shahpura → Jaipur.
3. **Interior Route**: Chirawa → Mandawa → Fatehpur → Sikar.

#### Algorithm Selection Hierarchy
To ensure robust testing and backward compatibility, the server implements a priority-based selection for the routing algorithm:
1. **gRPC Metadata**: `use-real-algo: true` (High Priority - set by `pytest`).
2. **Environment Variable**: `USE_REAL_ALGO=true` (Medium Priority - set by manual launch).
3. **Default**: `false` (Low Priority - falls back to Stage 1 Dummy Tracer).

#### Coordinate Snapping
The `find_nearest_node` function uses the Haversine formula to compute distances between arbitrary input coordinates and all nodes in the `STATIC_NODES` array, snapping the request to the closest graph entrance/exit.

### Directory Structure
- `server.py`: gRPC service implementation and Python entry point.
- `core/engine.cpp`: High-performance C++ calculation logic.
- `proto/`: Protobuf definitions and generated code.
- `setup.py`: Build configuration for the C++ extension.

### API Contract (`route_engine.proto`)
```proto
service RouteService {
    rpc CalculateRoute (RouteRequest) returns (RouteResponse) {}
}
```

## 3. Verification
- **Automated Tests**: `pytest` in `tests/routing_engine/test_server.py`.
- **Manual Verification**: Launch `python server.py` and verify "Listening on port 50051".

