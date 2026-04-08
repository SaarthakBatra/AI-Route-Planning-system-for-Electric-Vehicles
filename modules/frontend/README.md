# AI Route Planner - Frontend Module

The Frontend module provides an intuitive, high-fidelity interactive map interface for the AI Route Planner. Built with vanilla technologies and Leaflet.js, it delivers a premium user experience characterized by glassmorphism, fluid animations, and real-time algorithmic feedback.

## 1. System Architecture

### 1.1 High-Level Interaction Flow
```mermaid
graph TD
    A[User Input/Map Click] --> B[App State Manager]
    B --> C{Action Type}
    C -- "Location Search" --> D[Nominatim API]
    C -- "Calculate" --> E[Backend API /api/routes/calculate]
    D --> B
    E --> F[Route Response Parser]
    F --> G[Multi-Layer Polyline Renderer]
    F --> H[Algorithm Toast Spawner]
    G --> I[Leaflet Map View]
    H --> J[Glassmorphic Notifications]
```

### 1.2 Data Orchestration Sequence
```mermaid
sequenceDiagram
    participant U as User
    participant A as app.js
    participant B as Backend API
    participant M as Leaflet Map

    U->>A: Click Map / Search
    A->>M: Plot Marker (Start/End)
    U->>A: Click "Calculate Route"
    A->>B: POST /api/routes/calculate (JSON)
    B-->>A: RouteResponse (5 Algorithm Results)
    Note over A: Multi-path offset calculation
    A->>M: Render 5 Polylines (Stacked)
    A->>U: Spawn 5 Performance Toasts
```

## 2. Real-World Scenarios

### Scenario A: The "Identical Path" Overlap
*   **The Problem**: Multiple algorithms (e.g., A* and Dijkstra) often return identical optimal paths. If rendered directly, the polylines would overlap perfectly, hiding the multi-algorithm nature of the results.
*   **The Solution**: **Dynamic Pixel Offsetting**.
*   **Behavior**: The frontend detects identical polylines and groups them into a "bundle." Each path is then offset by a specific pixel width calculated based on the zoom level, creating a distinct "multi-lane" visual effect.

### Scenario B: High-Latency Comparison Suite
*   **The Problem**: Running 5 complex algorithms in parallel on the backend can take 1-2 seconds. Without feedback, the user might think the app is frozen.
*   **The Solution**: **Staggered Glassmorphic Toasts**.
*   **Behavior**: As soon as the API returns, toasts enter the viewport with a 100ms stagger and slide-in animations. A loading state is maintained on the primary button until all results are rendered.

## 3. The War Room: Bugs Faced & Solved

| Issue | Root Cause | Resolution |
| :--- | :--- | :--- |
| **Polyline Drift** | Lat/Lng offsets caused paths to "float" off roads when zooming. | Refactored to **Pixel-Space Offsets** calculated at `zoomend`. |
| **Search Debounce Lag** | Rapid typing triggered 10+ API calls per second to Nominatim. | Implemented **800ms Debounce** with search-on-spacebar trigger. |
| **Toast Overflow** | 5 large notifications covered the entire map on mobile devices. | Implemented **Auto-Minimization** after 60s and a compact 40px view. |
| **DOM Node Leak** | Resetting the map didn't destroy previous event listeners. | Centralized event management and used `.off()` for Leaflet events. |

## 4. Recent Updates (v1.3.0)

### 4.1 Configuration (Environment Aware)
The v1.3.0 update introduces **Dynamic API Discovery** to support hybrid development (e.g., serving the frontend from VS Code Live Server on port 5500 while the backend runs on port 3000).

- **`apiBaseUrl`**: Automatically detected in `app.js`. 
  - *Local Dev*: Targets `http://localhost:3000` by default.
  - *Production*: Reverts to an empty string for relative pathing.
- **How to change the Backend Port**:
  If your backend is running on a different port (e.g., 4000), update the `apiBaseUrl` line in the `appConfig` object within `modules/frontend/app.js`:
  ```javascript
  apiBaseUrl: 'http://localhost:4000',
  ```
- **`defaultTheme`**: Set the initial map style via `mapConfig.defaultTheme` in `app.js`.
  - Options: `'light'`, `'dark'`, `'satellite'`.
  - Default: `'light'`.

### 4.2 Core Modules
-   **Config Standardization**: All API and Tile endpoints are centralized in the `appConfig` and `mapConfig` objects.
-   **Deduplicated Logic**: Nominatim API calls share a private `_fetchNominatim` helper to prevent code rot.
-   **Enhanced Error Feedback**: Standardized detection of "Limit Exceeded" and "No Path Found" states based on backend results (`distance: 0`, `cost: 0`, `circuit_breaker_triggered`).
-   **Responsive Interaction**: Hover-syncing between toast cards and map polylines for high-fidelity comparison.

### 4.3 Failure Signatures & UX
| State | Indicator | Backend Signal | UI Behavior |
| :--- | :--- | :--- | :--- |
| **SUCCESS** | Green Polyline | `distance > 0` | Displays metrics (Time/Dist) and full path. |
| **LIMIT EXCEEDED** | Red Toast + Badge | `breaker_triggered: true` | Metric values replaced with `---`. |
| **NO PATH FOUND** | Orange Toast + Badge | `dist: 0, cost: 0` | Signifies unreachable destination in valid map. |

## 5. 🏗️ Features

- **Stage 5 EV Mission Control**: Physics-based configuration for Payload, Battery Health (SoH), and SoC thresholds.
- **Glassmorphic UI**: High-fidelity control panels and reactive performance telemetry toasts with backdrop filters.
- **Pareto-Optimal Visualization**: Renders complex multi-objective paths with arrival SoC and energy cost data.
- **Charger Transparency Ontology**: Shape-distinct markers for fast chargers, unknown ports, and offline status.
- **Plan vs Reality Tracking**: Real-time SoC deviation alerts with automated "Conservative Recompute" triggers.
- **Regenerative Braking Rendering**: Visualizes energy recovery segments as dashed polyline traces.
- **Pixel-Perfect Bundling**: Stacked polyline rendering for overlapping multi-algorithm paths.
- **Smart Search**: Autocomplete suggestions via Nominatim with intelligent debouncing.
- **Circuit Breaker Visualization**: UI feedback (badges and failure styling) for search limit exceeded states.
- **Multi-Theme Support**: Toggle between Dark, Light, and Satellite imagery on the fly.

## 6. 🛠️ Tech Stack

- **Logic**: ES6+ JavaScript (Vanilla).
- **Mapping**: Leaflet.js.
- **Styling**: Vanilla CSS3 with Custom Variables.
- **Linter**: ESLint (Flat Config).

## 7. 🧪 Testing & Quality

Execute the test suite:
```bash
npm test
```
Run the linter:
```bash
npm run lint
```

---
*Refer to `module-spec.md` for full implementation boundaries.*
