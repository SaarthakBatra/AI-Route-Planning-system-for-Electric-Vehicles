# Frontend Module Specification

## 1. Requirements

### User Stories
- As a user, I want a visual map interface to plan and view EV routes.
- As a user, I want to search for locations using text input or by clicking on the map.

### Acceptance Criteria (Step 1: Tracer Bullet Complete)
- **Status**: ✅ VERIFIED
- Interactive map interface implemented via Leaflet.js.
- Supports theme switching (Dark, Light, Satellite).
- Captures coordinates and orchestrates basic API calculation request.
- Visualizes returned polylines with automated bounds fitting.

### Acceptance Criteria (Step 2: Classical Routing Complete)
- **Status**: ✅ VERIFIED
- **Map Interaction**: Connect real map clicks to the API to determine Start and End points.
- **API Consumption**: Parse standardized response nested under `data.data.routes[0]`.
- **UI Metrics**: Extract and render `distance` (meters) and `duration` (seconds) in human-readable formats (e.g., '14.2 km', '12 mins').
- **Standard Logging**: Detailed console logging for outbound coordinates and inbound standardized response payloads.

## 2. Design

### Architecture & Tech Stack
- **Foundation**: Vanilla HTML5, CSS3, ES6 JavaScript.
- **Mapping**: Leaflet.js (CDN).
- **Styling**: Modern CSS with glassmorphism and custom typography (Inter).

### Directory Structure
- `index.html`: Main entry point and layout with hidden info panels.
- `style.css`: Design system, component styling, and fade-in animations.
- `app.js`: Application logic, state management, and robust API orchestration.

### Data Models
- **Coordinate**: `{ lat: number, lng: number }`
- **RouteRequest**: `{ start: Coordinate, end: Coordinate }`
- **RouteResponse**: 
  ```json
  {
    "success": boolean,
    "data": {
      "routes": [
        {
          "path": Array<Coordinate>,
          "distance": number,
          "duration": number
        }
      ]
    }
  }
  ```

## 3. Verification
- **Unit Tests**: `tests/frontend.test.js` (validates `formatCoord`, `displayCoord`, `formatDistance`, `formatDuration`).
- **Interactive Verification**: Manual testing of map clicks, metric display updates, and Reset functionality.

