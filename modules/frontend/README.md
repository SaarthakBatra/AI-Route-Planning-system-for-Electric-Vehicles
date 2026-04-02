# Frontend Module

The Frontend module provides an intuitive, interactive map-based interface for the AI Route Planner. Built with vanilla technologies and Leaflet.js, it offers a high-performance, lightweight user experience.

## 🚀 Quick Start

1. Open `index.html` in your browser.
2. Ensure the Backend module is running on `http://localhost:3000`.

## 🏗️ Features

- **Dynamic Mapping**: Interactive Leaflet interface with multiple themes.
- **Smart Search**: Autocomplete suggestions via Nominatim as you type.
- **Visual Feedback**: Real-time rendering of route polylines and markers.
- **Classical Routing (Step 2)**: Standard Dijkstra-based pathfinding in defined map zones.
- **Real-time Metrics**: Extraction and human-readable formatting of distance (km/m) and duration (mins/hrs).
- **Geolocation**: Precision map centering based on browser location.
- **Modern UI**: Glassmorphic control panels for a premium feel.

## 🏗️ Architecture

- **State**: Centralized in `app.js` managing coordinates, markers, and metrics.
- **Events**: Heavy reliance on event delegation for map clicks and input handling.
- **Styles**: Custom CSS variables for theme management and responsive layout.
- **API Orchestration**: Robust JSON parsing for the standardized `/api/routes/calculate` endpoint.

## 🛠️ Tech Stack
- **HTML5 / CSS3**: Structural and visual layers.
- **JavaScript (ES6+)**: Logic and API orchestration.
- **Leaflet.js**: Mapping and geometry engine.

## 🧪 Testing

Execute the central test suite from the project root:
```bash
node tests/main_test_runner.js
```
Or run frontend logic tests specifically:
```bash
node tests/frontend.test.js
```

*Refer to `module-spec.md` for full implementation boundaries.*
