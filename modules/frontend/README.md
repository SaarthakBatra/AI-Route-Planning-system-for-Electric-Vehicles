# Frontend Module

The Frontend module provides an intuitive, interactive map-based interface for the AI Route Planner. Built with vanilla technologies and Leaflet.js, it offers a high-performance, lightweight user experience.

## 🚀 Quick Start

1. Open `index.html` in your browser.
2. Ensure the Backend module is running on `http://localhost:3000`.

## 🏗️ Features

- **Dynamic Mapping**: Interactive Leaflet interface with multiple themes.
- **Smart Search**: Autocomplete suggestions via Nominatim as you type.
- **Visual Feedback**: Real-time rendering of route polylines and markers.
- **Geolocation**: Precision map centering based on browser location.
- **Modern UI**: Glassmorphic control panels for a premium feel.

## 🏗️ Architecture

- **State**: Centralized in `app.js` managing coordinates and markers.
- **Events**: Heavy reliance on event delegation for map clicks and input handling.
- **Styles**: Custom CSS variables for theme management and responsive layout.

## 🛠️ Tech Stack
- **HTML5 / CSS3**: Structural and visual layers.
- **JavaScript (ES6+)**: Logic and API orchestration.
- **Leaflet.js**: Mapping and geometry engine.

## 🧪 Testing
Run utility tests from the project root:
```bash
node tests/frontend.test.js
```

*Refer to `module-spec.md` for full implementation boundaries.*
