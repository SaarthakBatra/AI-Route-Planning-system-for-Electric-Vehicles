# Frontend Module

Welcome to the internal Frontend module directory.

## Purpose
This module houses the Vanilla HTML/CSS/JS mapping UI and its dynamic Javascript logic. We utilize Leaflet.js with OSM raster tiles to deliver a snappy, lightweight rendering experience decoupled from heavy third-party vendor lock-in.

## Design Rules
1. Never bypass the API Gateway to interact directly with the Python routing core or Database.
2. Adhere to strict JSDoc/TypeScript-like documentation.
3. Fail gracefully. If the backend fails to parse a route, visually alert the user instead of unhandled promise rejections.

*Refer to `module-spec.md` for full implementation boundaries.*
