# Routing Engine Module

## Purpose
The mathematical powerhouse. We split the architecture into Python for smooth gRPC microservice interfacing, and raw C++ for algorithm processing speed limits natively wrapped via `pybind11`.

*Refer to `module-spec.md` for full implementation boundaries.*

---

## Development Lifecycle & Build Rules

You **do not** need to rebuild the entire pipeline every time you run the application. Below is a breakdown of exactly what steps are required depending on your workflow.

### 1. Running Tests (No Manual Server Required)
> [!WARNING]
> **Do NOT run `python server.py` before running tests.** The pytest fixture (`grpc_server`) starts and manages its own in-process server on port 50051 automatically. If an external server is already occupying the port, the test fixture will now **fail immediately** with a clear error message. These two modes are mutually exclusive.

```bash
# ✅ Correct: run tests with no external server running
node tests/main_test_runner.js

# ✅ Correct: run python tests directly
cd modules/routing_engine && source venv/bin/activate
pytest ../../tests/routing_engine/

# ❌ Wrong: starting the server before tests causes a port conflict
python server.py  # ← stop this before running tests
node tests/main_test_runner.js
```

### 2. Running for Manual / Backend Integration Testing
To start the routing engine for connection to the backend, run the python server. It now defaults to the Stage 3 Academic Parallel Suite.
```bash
source venv/bin/activate
python server.py
# For Stage 1 (dummy tracer bullet):
DEBUG_MODE=true python server.py
```
*(Note: If you are running tests via `node tests/main_test_runner.js`, the script automatically hooks into the executable path.)*

### 3. Modifying Python Code (`server.py`)
If you change logic in the Python server:
- **Action Required**: None. Python interprets on the fly.
- **Steps**: Just restart the server (`Ctrl+C` and `python server.py`).

### 4. Modifying C++ Algorithms (`core/engine.cpp` or `binding.cpp`)
If you update the mathematical routing logic or add new C++ bindings:
- **Action Required**: You must recompile the C++ extension. **Ensure `-pthread` is linked as the engine now uses `std::async`.**
- **Steps**:
  ```bash
  source venv/bin/activate
  python setup.py build_ext --inplace
  # Restart python server.py
  ```

### 5. Modifying gRPC Contracts (`proto/route_engine.proto`)
If you change the data shape:
- **Action Required**: Regenerate the Python stubs.
- **Steps**:
  ```bash
  source venv/bin/activate
  python -m grpc_tools.protoc -I./proto --python_out=./proto --grpc_python_out=./proto ./proto/route_engine.proto
  ```

---

## Technical Context for Agents

### Search Suite Performance (Stage 3)
The engine executes 5 algorithms concurrently utilizing all available CPU cores. Each algorithm returns a unique footprint:

- **Uninformed**: BFS, Dijkstra, IDDFS.
- **Informed**: A* and IDA* (using Haversine $h_d$ and Temporal $h_t$ heuristics).
- **Objectives**: Supports `FASTEST` (Duration) and `SHORTEST` (Distance) optimization.

### Data Schema: `AlgorithmResult` (C++)
When modifying `core/engine.cpp`, note the `AlgorithmResult` struct:
- `algorithm`: `std::string` (Name of algorithm).
- `path`: `std::vector<std::pair<double, double>>` (lat/lng coordinates).
- `distance_m`: `double` (Total distance).
- `duration_s`: `double` (Total duration).
- `nodes_expanded`: `int` (Count of nodes expanded).
- `exec_time_ms`: `double` (Raw execution time in ms).
- `path_cost`: `double` (Objective-specific scalar cost).

### Algorithm Selection (gRPC Metadata)
Since Stage 3, the server defaults to the parallel search suite. To trigger the Stage 1 legacy dummy tracer, send:
- Key: `debug-mode`
- Value: `true` (string)

This is the preferred method for bypassing pathfinding during frontend-only validation.

### L3 Mock Traffic Multipliers
Mock traffic injection is governed by the `mock_hour` gRPC field:
- **Peak (08:00–10:00, 17:00–19:00)**: Multipliers applied (Trunk: 1.2x, Primary: 1.5x, Secondary: 1.8x, Tertiary: 2.0x).
- **Off-Peak**: All multipliers are at 1.0x.

---

## System Integration Examples

### Use Case: Adding a New Heuristic
1. Developer edits `core/engine.cpp` to add a new `get_custom_heuristic()`.
2. Developer runs `python setup.py build_ext --inplace` to recompile `route_core.so`.
3. Developer verifies the heuristic change in `A*` or `IDA*`.

### Use Case: Exposing Algorithm Choice
1. Developer edits `proto/route_engine.proto` to add `AlgorithmSelection` enum.
2. Developer regenerates Python stubs.
3. Developer maps the new gRPC request field inside `server.py` to filter the returned `results` array.
