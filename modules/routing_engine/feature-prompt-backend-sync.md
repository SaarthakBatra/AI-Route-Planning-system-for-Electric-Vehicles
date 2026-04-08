# Feature Prompt: Backend Orchestration Sync for Routing Engine v2.3.0

## Goal
Update the Backend gRPC orchestration layer to synchronize with the Routing Engine's migration to Native C++ Watchdogs and Direct I/O.

## Context
The Routing Engine has been refactored to a synchronous, C++ native diagnostic model (v2.3.0). It no longer accepts legacy environment variables for log caps; instead, it relies on strict gRPC metadata keys for search lifecycle management.

## Required Modifications in `modules/backend/orchestrator.py`

1. **Streamline Metadata Injection**:
   Inject the following keys into the `RouteService.CalculateRoute` gRPC metadata:
   - `algo-debug` (bool): Enable native C++ traces.
   - `kill-time-ms` (int): Search mission time limit (Default: 60000).
   - `debug-node-interval` (int): Native hardware flush frequency (Default: 5000).
   - `log-dir` (string): Absolute session ID for directory mapping.

2. **Remove Environment Fallbacks**:
   Ensure `ALGO_DEBUG`, `ALGO_KILL_TIME_MS`, and `ALGO_DEBUG_NODE_INTERVAL` are extracted from the application config or database and passed strictly via metadata. Do NOT rely on sharing environment variables with the Routing Engine process.

3. **Handle Truncated Responses**:
   The Routing Engine now returns a truncation marker in `res.debug_logs` (e.g., `(TRUNCATED: Native I/O...)`). The Backend should detect this and correctly link the user to the local `Output` folder in UI responses.

## Verification
- Run `pytest tests/backend/test_orchestrator.py` to ensure metadata propagation is correct.
- Verify that searches hitting the new `kill-time-ms` limit return a `circuit_breaker_triggered = True` status.
