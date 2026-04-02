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

### 2. Running the App for Manual / Backend Integration Testing
To start the routing engine for connection to the backend, simply run the python server. No recompilation is necessary.
```bash
source venv/bin/activate
python server.py
# For Stage 2 (real Dijkstra algorithm):
USE_REAL_ALGO=true python server.py
```
*(Note: If you are running tests via `node tests/main_test_runner.js`, the script automatically hooks into the executable path, so you don't even need to activate the venv manually!)*

### 2. Modifying Python Code (`server.py`)
If you change logic in the Python server:
- **Action Required**: None. Python interprets on the fly.
- **Steps**: Just restart the server (`Ctrl+C` and `python server.py`).

### 3. Modifying C++ Algorithms (`core/engine.cpp` or `binding.cpp`)
If you update the mathematical routing logic or add new C++ bindings:
- **Action Required**: You must recompile the C++ into the shared python library via `pybind11`.
- **Steps**:
  ```bash
  source venv/bin/activate
  python setup.py build_ext --inplace
  # Restart python server.py
  ```

### 4. Modifying gRPC Contracts (`proto/route_engine.proto`)
If you change the data shape sent between Node.js and the Python engine:
- **Action Required**: You must regenerate the Python stubs and interfaces.
- **Steps**:
  ```bash
  source venv/bin/activate
  python -m grpc_tools.protoc -I./proto --python_out=./proto --pyi_out=./proto --grpc_python_out=./proto ./proto/route_engine.proto
  # Restart python server.py
  ```

---

## Technical Context for Agents

### Graph Topology (Stage 2)
The engine currently operates on a **static graph of 26 nodes** representing the Pilani-Jaipur road network. There are three primary corridors:

1. **The Sikar-Ringus Route (NH-52)**
   - Path: Pilani → Chirawa → Jhunujhunu → Sikar → Ringus → Chomu → Jaipur.
   - Characterized by high-speed NH-52 (100 km/h).
2. **The Narnaul-Kotputli Route (NH-11/NH-48)**
   - Path: Pilani → Chirawa → Singhana → Narnaul → Kotputli → Shahpura → Jaipur.
   - Geometric shortest path from Pilani (~200km).
3. **Interior Agricultural Route**
   - Path: Chirawa → Mandawa → Fatehpur → Sikar.
   - Slower local roads (50-60 km/h).

### Data Schema: `RouteResult` (C++)
When modifying `core/engine.cpp`, note the `RouteResult` struct returned by `calculate_route`:
- `path`: `std::vector<std::pair<double, double>>` (lat/lng coordinates).
- `distance_m`: `double` (total distance in meters).
- `duration_s`: `double` (total duration in seconds).
- `node_ids`: `std::vector<int>` (IDs of visited graph nodes).

### Algorithm Selection (gRPC Metadata)
To trigger the Stage 2 Dijkstra algorithm without setting environment variables, send the following gRPC metadata with your request:
- Key: `use-real-algo`
- Value: `true` (string)

This is the preferred method for automated testing as it avoids process-level side effects.

---

## System Integration Examples
1. Developer edits `core/engine.cpp` to add aerodynamic drag calculations.
2. Developer runs `python setup.py build_ext --inplace` to recompile `route_core.so` (or `route_core.pyd` on Windows).
3. Developer restarts `server.py` and hits the API to test the newly compiled C++ speed/logic.

### Use Case B: Exposing Battery State Parameter
1. Developer edits `proto/route_engine.proto` to add `double current_battery_soc = 3;` to `RouteRequest`.
2. Developer runs `python -m grpc_tools.protoc -I./proto ...` to generate the new python interface classes.
3. Developer maps the new `request.current_battery_soc` variable natively in `server.py` and passes it directly to the Pybind11 C++ function.
4. Restart `server.py`.
