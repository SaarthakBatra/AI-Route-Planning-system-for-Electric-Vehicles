# Feature Prompt: Routing Engine Zero-Context Hardening (v2.2.0)

<module_name>routing_engine</module_name>

<objective>
Update the Routing Engine's gRPC server to fully adopt the v2.2.0 metadata-driven architecture, specifically integrating the dynamic `log-flush-interval` and removing legacy environment fallbacks.
</objective>

<requirements>
1. **Dynamic Heartbeat Integration**:
   - Update `modules/routing_engine/server.py` to extract `log-flush-interval` from gRPC metadata.
   - Dynamically update the `GLOBAL_FLUSH_INTERVAL` used by the `periodic_flush()` background thread for every request.
2. **Strict Zero-Context Architecture**:
   - Refactor hyperparameter extraction in `CalculateRoute` to prioritize gRPC metadata keys:
     - `max-nodes`
     - `soc-discretization-step`
     - `debug-log-cap`
     - `log-flush-nodes`
     - `log-flush-interval`
     - `epsilon-min`
     - `banding-shortest`
     - `banding-fastest`
     - `log-interval`
   - Use strict internal defaults if metadata is missing, and log a `DEBUG` warning. **Do not fall back to `os.getenv` for these keys** once inside the request context.
3. **Verification**:
   - Update `tests/routing_engine/test_engine_diagnostics.py` to verify that passing `log-flush-interval: 1` in metadata actually triggers frequent log writes during a long search.
</requirements>

<affected_files>
- modules/routing_engine/server.py
- tests/routing_engine/test_engine_diagnostics.py
</affected_files>

<design_notes>
The Backend has been refactored to an options-object pattern. The Routing Engine should remain stateless, and its behavior should be entirely determined by the incoming request metadata and Protobuf payload.
</design_notes>
