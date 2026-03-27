# Frontend Module Specification

## 1. Requirements

### User Stories
- As a user, I want a visual map interface to plan and view EV routes.
- As a user, I want to search for locations using text input or by clicking on the map.

### Acceptance Criteria (Step 1: Tracer Bullet Complete)
- **Status**: ✅ VERIFIED
- Interactive map interface implemented via Leaflet.js.
- Supports theme switching (Dark, Light, Satellite).
- Geolocation support for automatic map centering.
- Integrated Nominatim API for real-time location autocomplete and geocoding.
- Captures Start/End coordinates and orchestrates the `/api/routes/calculate` request.
- Visualizes returned route polylines with automated bounds fitting.
- Responsive design with UI panels using glassmorphism effects.

## 2. Design

### Architecture & Tech Stack
- **Foundation**: Vanilla HTML5, CSS3, ES6 JavaScript.
- **Mapping**: Leaflet.js (CDN).
- **Styling**: Modern CSS with glassmorphism and custom typography (Inter).

### Directory Structure
- `index.html`: Main entry point and layout.
- `style.css`: Design system and component styling.
- `app.js`: Application logic, state management, and API orchestration.

### Data Models
- **Coordinate**: `{ lat: number, lng: number }`
- **RouteRequest**: `{ start: Coordinate, end: Coordinate }`
- **RouteResponse**: `{ success: boolean, data: { path: Array<Coordinate> } }`

## 3. Verification
- **Unit Tests**: `tests/frontend.test.js` (validates utility functions).
- **Manual Verification**: Functional testing of map clicks, geocoding, and polyline rendering.

