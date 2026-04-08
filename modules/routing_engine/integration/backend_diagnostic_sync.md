# Feature Prompt: Synchronizing Diagnostic Parameters with Routing Engine

## Objective
Update the `modules/backend` module to support the new diagnostic parameters introduced in the Routing Engine (`ROUTING_DEBUG_LOG_CAP` and `ROUTING_LOG_FLUSH_NODES`). These parameters must be read from the Backend's environment and passed via gRPC metadata to ensure real-time log flushing and depth control for EV routing searches.

## Context
The Routing Engine now supports "Heartbeat" logging where search algorithms flush diagnostic chunks every $N$ nodes. It also supports a dynamic cap for granular node-level tracing. To make these parameters manageable, they should be controlled by the Backend orchestrator.

## Required Changes

### 1. Environment Configuration (`modules/backend/.env`)
Add the following variables to the Backend's environment (matching the Routing Engine defaults):
```env
# Depth of granular Step-by-Step logs before switching to periodic progress reports
ROUTING_DEBUG_LOG_CAP=1000000

# Frequency (in node expansions) for heartbeat log flushes to Discord/Output
ROUTING_LOG_FLUSH_NODES=5000
```

### 2. Update gRPC Client (`modules/backend/services/grpcClient.js`)
- Update the `calculateRouteGrpc` function signature to accept `debug_log_cap` and `log_flush_nodes`.
- Inject these into the gRPC `Metadata` object:
    - Key: `debug-log-cap`, Value: `debug_log_cap.toString()`
    - Key: `log-flush-nodes`, Value: `log_flush_nodes.toString()`

### 3. Update Controller Logic (`modules/backend/controllers/calculateRoute.js`)
- Read `ROUTING_DEBUG_LOG_CAP` and `ROUTING_LOG_FLUSH_NODES` from `process.env`.
- Pass these values down through `calculateRouteGrpc`.
- Ensure standard fallbacks (1,000,000 for cap, 5,000 for flush) are in place if env vars are missing.

### 4. Update Module Specification (`modules/backend/module-spec.md`)
- Update Section 2.2 (Environmental Coordination) to reflect these new variables.
- Update Section 2.3 (gRPC Orchestration Contract) to include the new metadata keys.

## Acceptance Criteria
- [ ] Backend reads `ROUTING_DEBUG_LOG_CAP` and `ROUTING_LOG_FLUSH_NODES` from `.env`.
- [ ] Values are correctly passed in gRPC metadata for every routing request.
- [ ] `module-spec.md` is updated to reflect the new diagnostic contract.
