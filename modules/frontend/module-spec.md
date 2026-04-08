# Frontend Module Specification

## 1. Requirements

### User Stories
- **Interactive Planner**: As a user, I want a high-fidelity visual map interface to plan and view multi-algorithm EV routes in real-time.
- **Dynamic Search**: As a user, I want to search for locations using text input with smart suggestions or by clicking directly on the map.
- **Traceability**: As a developer, I want to see the performance metrics of multiple algorithms simultaneously to compare search efficiency.
- **EV Mission Control (Stage 5)**: As an EV driver, I want to configure my vehicle's physical parameters (mass, drag, battery health) to receive Pareto-optimal routes that guarantee arrival SoC.
- **Real-World Tracking**: As a user, I want to input my actual SoC during trip execution and receive proactive "Conservative Recompute" suggestions if I deviate from the plan.

### Design Principles
- **Visual Excellence**: Use glassmorphism and smooth micro-animations to provide a premium, state-of-the-art user experience.
- **Responsiveness**: Ensure the interface is fluid and adapts to various screen dimensions without layout shifts.
- **Decoupled Logic**: Separate map visualization from API orchestration to allow for easy testing and maintenance.
- **State Persistence**: Maintain coordinate selection state across various UI interactions (theme switching, suggestion selection).

### Acceptance Criteria (Stage 5 Compliance)
- **Advanced EV Panel**: ✅ Interactive physics configuration with OEM presets (Tesla, Rivian, etc.).
- **Multi-Objective Visualization**: ✅ Standardized parsing of `data.data.results` including `arrival_soc_kwh` and `consumed_kwh`.
- **Charger Ontology**: ✅ Shape-distinct tri-color markers for fast, assumed, emergency, and offline chargers.
- **Regen Visualization**: ✅ Dashed polyline rendering for regenerative braking segments ($E_{consumed} < 0$).
- **Plan vs Reality**: ✅ Integrated "Trip Execution Panel" for SoC deviation tracking and automated margin inflation.
- **Enhanced Failure Mapping**: ✅ Detection of "Limit Exceeded" and "No Path Found" states.

## 2. Design

### Architecture & Tech Stack
- **Foundation**: Vanilla HTML5, CSS3 (Custom Variables), ES6+ JavaScript.
- **Mapping**: Leaflet.js (CDN implementation) for geometry rendering.
- **State Management**: Centralized `state` object in `app.js` containing `evParams` and `vehiclePresets`.
- **Communication**: Relative RESTful JSON patterns via `/api/routes/calculate`.

### Directory Structure
- `index.html`: Viewport with map, route form, EV panel, and Trip Execution panel.
- `style.css`: Design system, glassmorphic toast styles, charger ontologies, and regen segment styles.
- `app.js`: Core orchestration, physics-based UI state, and Plan vs Reality logic.

### Data Models & API Contracts

#### Outbound Request (`RouteRequest`)
| Property | Type | Description |
| :--- | :--- | :--- |
| `start` | `Coordinate` | `{ lat: number, lng: number }` |
| `end` | `Coordinate` | `{ lat: number, lng: number }` |
| `objective` | `string` | "Fastest" or "Shortest" |
| `mock_hour` | `number` | Simulated traffic hour (0-23) |
| `ev_params` | `Object` | Nested physics and battery parameters (Stage 5) |

#### `ev_params` Schema
```json
{
  "enabled": boolean,
  "effective_mass_kg": number,
  "drag_coeff": number,
  "aux_power_kw": number,
  "start_soc_kwh": number,
  "battery_soh_pct": number,
  "min_arrival_soc_kwh": number,
  "energy_uncertainty_margin_pct": number,
  ...
}
```

#### Inbound Response (`RouteResponse`)
```json
{
  "success": boolean,
  "data": {
    "results": Array<AlgorithmResult>
  }
}
```

#### AlgorithmResult Extensions (Stage 5)
| Property | Type | Description |
| :--- | :--- | :--- |
| `arrival_soc_kwh` | `number` | Estimated SoC at destination. |
| `consumed_kwh` | `number` | Total energy used. |
| `polyline` | `Array` | Coordinate pairs, some flagged with `is_charging_stop`. |

## 3. Verification

### Automated Tests
- `npm test`: Validates coordinate formatting, SoC-to-kWh conversion, and payload construction.
- `npm run lint`: Enforces zero-violation linting.

### Manual Verification
1. **Mission Execution**: Log 3% deviation at Waypoint 1; verify "Conservative Recompute" triggers.
2. **Visual Audit**: Verify dashed lines appear on downhill segments (Regen).
3. **Charger Ontology**: Click "Fast Charger" icon and verify tooltip shows `Yellow Circle`.

## 4. Maintenance (Quality Guardian)
- **Physics Synchronization**: All values sent to `/api/calculateRoute` must match gRPC units (kg, m², kW, kWh).
- **Graceful Fallbacks**: If `ev_params` is disabled, the engine must return standard Time/Distance metrics without energy overhead.

