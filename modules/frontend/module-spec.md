# Frontend Module Specification

## 1. Requirements

### User Stories
- **Interactive Planner**: As a user, I want a high-fidelity visual map interface to plan and view multi-algorithm EV routes in real-time.
- **Dynamic Search**: As a user, I want to search for locations using text input with smart suggestions or by clicking directly on the map.
- **Traceability**: As a developer, I want to see the performance metrics of multiple algorithms simultaneously to compare search efficiency.

### Design Principles
- **Visual Excellence**: Use glassmorphism and smooth micro-animations to provide a premium, state-of-the-art user experience.
- **Responsiveness**: Ensure the interface is fluid and adapts to various screen dimensions without layout shifts.
- **Decoupled Logic**: Separate map visualization from API orchestration to allow for easy testing and maintenance.
- **State Persistence**: Maintain coordinate selection state across various UI interactions (theme switching, suggestion selection).

### Acceptance Criteria (v1.2.0 Compliance)
- **Multi-Algorithm Visualization**: ✅ Standardized parsing of `data.data.results` (Array of 5 Algorithm Result Objects).
- **Overlapping Path Logic**: ✅ Implements pixel-perfect stacking for identical route segments using dynamic offsets.
- **Interactive Toasts**: ✅ Glassmorphic notification cards with manual minimize/close and auto-minimization timers.
- **Hover Synergy**: ✅ Context-aware highlighting where hovering a toast card emphasizes the corresponding map polyline.
- **Smart Geocoding**: ✅ Integrated Nominatim search with debounced input and autocomplete dropdowns.

## 2. Design

### Architecture & Tech Stack
- **Foundation**: Vanilla HTML5, CSS3 (Custom Variables), ES6+ JavaScript.
- **Mapping**: Leaflet.js (CDN implementation) for geometry rendering.
- **State Management**: Centralized `state` object in `app.js` with event delegation for interactions.
- **Communication**: RESTful JSON patterns for the standardized `/api/routes/calculate` endpoint.

### Directory Structure
- `index.html`: Main viewport container with map div and notification overlays.
- `style.css`: Design system, glassmorphic toast styles, and theme-aware CSS tokens.
- `app.js`: Core orchestration logic, multi-layer visualization, and telemetry lifecycle.
- `package.json`: Dependency metadata and standard Quality Guardian scripts.
- `eslint.config.js`: Flat configuration for strict linting of browser-side JS.

### Data Models & API Contracts

#### Outbound Request (`RouteRequest`)
| Property | Type | Description |
| :--- | :--- | :--- |
| `start` | `Coordinate` | `{ lat: number, lng: number }` |
| `end` | `Coordinate` | `{ lat: number, lng: number }` |
| `objective` | `string` | "Fastest" or "Shortest" optimization goal. |
| `mock_hour` | `number` | Simulated traffic hour (0-23).|

#### Inbound Response (`RouteResponse`)
```json
{
  "success": boolean,
  "data": {
    "results": Array<AlgorithmResult>
  }
}
```

#### Internal State (`ApplicationState`)
```javascript
const state = {
    startCoords: { lat, lng },
    endCoords: { lat, lng },
    selectionMode: 'start' | 'end' | 'done',
    routeLayers: Array<L.Polyline>,
    originalStyles: Map<string, StyleMetadata>
};
```

## 3. Verification

### Automated Tests
- `npm test`: Runs `tests/frontend.test.js` to validate coordinate formatting, distance/duration logic, and utility functions.
- `npm run lint`: Enforces zero-violation linting against the project's design system using ESLint.

### Manual Verification
1.  **Multi-Theme Testing**: Verify map tile transitions between Dark, Light, and Satellite modes.
2.  **Overlap Stress Test**: Request multiple routes with identical segments and verify polyline bundle offset accuracy.
3.  **Interaction Pulse**: Hover over toast cards and verify 100% synchronization with map polyline opacity.

## 4. Maintenance (Quality Guardian)

### Refactoring Policy
- **Global `ui` Map**: All DOM interactions must be centralized via the `ui` object to prevent repeated node selection.
- **Debounce Enforcement**: Address search must utilize `appConfig.debounceTimeMs` to prevent API rate-limiting.
- **Polyline Bundle Logic**: Offsets for overlapping paths are calculated in pixel space at the `zoomend` event to maintain perfect stacking at all zoom levels.

### Quality Standards
- 100% adherence to JSDoc documentation for all complex functions.
- Zero globally leaked variables; all state must reside in the `state` object.
- Consistent single-quote usage and semicolon termination as per `eslint.config.js`.

