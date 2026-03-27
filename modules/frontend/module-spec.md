# Frontend Module Specification

## 1. Requirements

### User Stories
- **User Story 1:** As a user, I want to see a map interface so I can visualize my EV route.
- **User Story 2:** As a user, I want to input my start and end locations to calculate a route.

### Acceptance Criteria
- The application renders a prominent geographic map using Leaflet.js.
- The application attempts to detect the user's current geographic location on load to center the map (falling back to a default if unavailable).
- The map allows standard tile viewing, zooming, and panning, with zoom controls placed in the bottom right corner to avoid UI overlap.
- Users can switch between multiple map themes (Dark Theme, Light Theme, Satellite Theme).
- The UI provides an autocomplete dropdown offering real-time location suggestions as the user types via the Nominatim API.
- For Step 1 (Tracer Bullet), the frontend successfully captures these coordinates, sends them to the Backend API (when ready), and renders a returned mock route polyline.

## 2. Design

### Architecture
- **Tech Stack:** Vanilla HTML5, CSS3, and custom ES6 JavaScript. No heavy frontend frameworks (React/Vue).
- **State Management:** Local JS variables in `app.js`.

### Dependencies
- **Leaflet.js:** Included via CDN for mapping, raster tile rendering, and polyline drawing.

### Data Models
- **Coordinate:**
  ```typescript
  { lat: number, lng: number }
  ```
- **RouteRequest:**
  ```typescript
  {
      start: Coordinate,
      end: Coordinate
  }
  ```
- **RouteResponse:**
  Expected JSON containing a polyline array of coordinates from the Backend:
  ```typescript
  { success: boolean, data: { path: Array<{lat: number, lng: number}> } }
  ```

### API Contracts
- **Endpoint:** `POST http://localhost:3000/api/routes/calculate`
- **Role:** The frontend will `fetch()` this endpoint with the `RouteRequest` payload and parse the returned `path` array into a Leaflet polyline overlay (`L.polyline`). The call must be wrapped in `try/catch` per code-style rules to ensure the UI gracefully handles 400/500 errors.

## 3. Tasks (Step 1 Initialization)

1. Scaffold `modules/frontend/` with `index.html`, `style.css`, and `app.js`.
2. Setup base HTML document, import Leaflet.js CSS/JS, and style the map container.
3. Instantiate the Leaflet map in `app.js` with OSM raster tiles.
4. Implement UI mapping for Start/End point selection.
5. Write the asynchronous `fetch` integration to send coordinates and plot the returned route on the map.
