# Routing Engine Module

## Purpose
The mathematical powerhouse. We split the architecture into Python for smooth gRPC microservice interfacing, and raw C++ for algorithm processing speed limits natively wrapped via `pybind11`.

*Refer to `module-spec.md` for full implementation boundaries.*

---

## Development Lifecycle & Build Rules

You **do not** need to rebuild the entire pipeline every time you run the application. Below is a breakdown of exactly what steps are required depending on your workflow.

### 1. Running the App (No Code Changes)
To start the routing engine for testing or connection to the backend, simply run the python server. No recompilation is necessary.
```bash
source venv/bin/activate
python server.py
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

## System Integration Examples

### Use Case A: Adding EV Physics to C++
1. Developer edits `core/engine.cpp` to add aerodynamic drag calculations.
2. Developer runs `python setup.py build_ext --inplace` to recompile `route_core.so` (or `route_core.pyd` on Windows).
3. Developer restarts `server.py` and hits the API to test the newly compiled C++ speed/logic.

### Use Case B: Exposing Battery State Parameter
1. Developer edits `proto/route_engine.proto` to add `double current_battery_soc = 3;` to `RouteRequest`.
2. Developer runs `python -m grpc_tools.protoc -I./proto ...` to generate the new python interface classes.
3. Developer maps the new `request.current_battery_soc` variable natively in `server.py` and passes it directly to the Pybind11 C++ function.
4. Restart `server.py`.
