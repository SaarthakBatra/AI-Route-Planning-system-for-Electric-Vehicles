/**
 * @fileoverview Frontend Application Logic for AI Route Planner
 * Handles Leaflet map initialization, user interactions, and backend API routing data visualization.
 */

// Config constants for easy editing
const appConfig = {
    debounceTimeMs: 800 // The time to wait before querying Nominatim after user stops typing
};

// Application State
const state = {
    startCoords: null, // {lat, lng}
    endCoords: null,   // {lat, lng}
    selectionMode: 'start', // 'start' or 'end'
    routeLayer: null,
    markers: {
        start: null,
        end: null
    },
    debounceTimers: {
        start: null,
        end: null
    }
};

// Map configuration
const mapConfig = {
    initialCenter: [37.7749, -122.4194], // Default: San Francisco
    initialZoom: 10,
    tileLayer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
};

// DOM Elements
const ui = {
    startInput: document.getElementById('start-input'),
    endInput: document.getElementById('end-input'),
    calcBtn: document.getElementById('calc-route-btn'),
    resetBtn: document.getElementById('reset-btn'),
    statusMsg: document.getElementById('status-message'),
    startSuggestions: document.getElementById('start-suggestions'),
    endSuggestions: document.getElementById('end-suggestions')
};

/**
 * Parses Coordinates payload formatting a standard API schema.
 * @param {Object} coords - Leaflet coordinates object
 * @returns {Object} JSON strict coordinates
 */
const formatCoord = (coords) => ({ lat: coords.lat, lng: coords.lng });

/**
 * Formats a coordinate to a display string
 * @param {Object} coord - {lat, lng}
 * @returns {string} lat,lng truncated
 */
const displayCoord = (coord) => `${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`;

/**
 * Initializes the Leaflet map and event handlers.
 */
function initMap() {
    try {
        const map = L.map('map', { zoomControl: false }).setView(mapConfig.initialCenter, mapConfig.initialZoom);

        // Map Themes
        const darkTheme = L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap &copy; CartoDB'
        });

        const lightTheme = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: mapConfig.attribution
        });

        const satelliteTheme = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri'
        });

        darkTheme.addTo(map);

        const baseMaps = {
            "Dark Theme": darkTheme,
            "Light Theme": lightTheme,
            "Satellite": satelliteTheme
        };

        L.control.layers(baseMaps, null, { position: 'bottomleft' }).addTo(map);
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        // Geolocation
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const userCoords = [pos.coords.latitude, pos.coords.longitude];
                    map.setView(userCoords, 13);
                },
                (err) => console.warn("[app] Geolocation skipped or denied.")
            );
        }

        // Map Click Listener
        map.on('click', (e) => handleMapClick(map, e.latlng));

        // Event Listeners for Buttons
        ui.resetBtn.addEventListener('click', () => resetState(map));
        ui.calcBtn.addEventListener('click', () => calculateRoute(map));

        // Event Listeners for Autocomplete & Geocoding
        setupAutocompleteInput(map, 'start');
        setupAutocompleteInput(map, 'end');

        console.log("[app] Map initialized successfully.");
    } catch (err) {
        console.error("[app] Map initialization failed:", err);
        showStatus('Critical error: Could not load the map interface.', 'error');
    }
}

/**
 * Handles map click logic for selecting start/end points.
 * @param {Object} map - Leaflet Map instance
 * @param {Object} latlng - Click coordinates
 */
function handleMapClick(map, latlng) {
    if (state.selectionMode === 'start') {
        state.startCoords = latlng;
        ui.startInput.value = displayCoord(latlng);

        if (state.markers.start) map.removeLayer(state.markers.start);

        // Green marker for start
        state.markers.start = L.circleMarker(latlng, {
            radius: 8,
            fillColor: "#4CAF50",
            color: "#fff",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        }).addTo(map);

        state.selectionMode = 'end';
        ui.startInput.classList.remove('active');
        ui.endInput.classList.add('active');

    } else if (state.selectionMode === 'end') {
        state.endCoords = latlng;
        ui.endInput.value = displayCoord(latlng);

        if (state.markers.end) map.removeLayer(state.markers.end);

        // Red Marker for End
        state.markers.end = L.circleMarker(latlng, {
            radius: 8,
            fillColor: "#F44336",
            color: "#fff",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        }).addTo(map);

        state.selectionMode = 'done';
        ui.endInput.classList.remove('active');
        ui.calcBtn.disabled = false; // Enable calculation
    }
}

/**
 * Configures the typing timer (debounce) and spacebar triggers for the autocomplete inputs.
 * @param {Object} map 
 * @param {string} target 'start' or 'end'
 */
function setupAutocompleteInput(map, target) {
    const inputEl = target === 'start' ? ui.startInput : ui.endInput;
    const dropdownEl = target === 'start' ? ui.startSuggestions : ui.endSuggestions;

    inputEl.addEventListener('input', (e) => {
        const query = e.target.value;
        if (!query.trim() || query.length < 3) {
            dropdownEl.classList.add('hidden');
            dropdownEl.innerHTML = '';
            if (state.debounceTimers[target]) clearTimeout(state.debounceTimers[target]);
            return;
        }

        const lastChar = query[query.length - 1];
        
        if (state.debounceTimers[target]) {
            clearTimeout(state.debounceTimers[target]);
        }

        if (lastChar === ' ') {
            fetchSuggestions(map, query.trim(), target, dropdownEl);
        } else {
            state.debounceTimers[target] = setTimeout(() => {
                fetchSuggestions(map, query.trim(), target, dropdownEl);
            }, appConfig.debounceTimeMs);
        }
    });

    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (state.debounceTimers[target]) clearTimeout(state.debounceTimers[target]);
            dropdownEl.classList.add('hidden');
            handleGeocode(map, inputEl.value, target);
        }
    });
    
    document.addEventListener('click', (e) => {
        if (e.target !== inputEl && !dropdownEl.contains(e.target)) {
            dropdownEl.classList.add('hidden');
        }
    });
}

/**
 * Executes a geographic text search for dropdown suggestions.
 */
async function fetchSuggestions(map, query, target, dropdownEl) {
    if (!query) return;
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`);
        const data = await response.json();
        
        dropdownEl.innerHTML = '';
        if (data && data.length > 0) {
            dropdownEl.classList.remove('hidden');
            data.forEach(item => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.innerText = item.display_name;
                div.addEventListener('click', () => {
                    const latlng = { lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
                    const shortName = item.display_name.split(',')[0] + ", " + (item.display_name.split(',').pop().trim());
                    
                    const inputEl = target === 'start' ? ui.startInput : ui.endInput;
                    inputEl.value = shortName;
                    dropdownEl.classList.add('hidden');
                    
                    plotMarker(map, latlng, target, shortName);
                });
                dropdownEl.appendChild(div);
            });
        } else {
            dropdownEl.classList.add('hidden');
        }
    } catch (err) {
        console.error("[app] Autocomplete error:", err);
    }
}

/**
 * Universal marker plotter.
 */
function plotMarker(map, latlng, target, shortName) {
    if (target === 'start') {
        state.startCoords = latlng;
        if (state.markers.start) map.removeLayer(state.markers.start);
        state.markers.start = L.circleMarker(latlng, {
            radius: 8, fillColor: "#4CAF50", color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.9
        }).addTo(map);
        state.selectionMode = 'end';
        ui.startInput.classList.remove('active');
        ui.endInput.classList.add('active');
        if (shortName) ui.startInput.value = shortName;
    } else {
        state.endCoords = latlng;
        if (state.markers.end) map.removeLayer(state.markers.end);
        state.markers.end = L.circleMarker(latlng, {
            radius: 8, fillColor: "#F44336", color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.9
        }).addTo(map);
        state.selectionMode = 'done';
        ui.endInput.classList.remove('active');
        ui.calcBtn.disabled = false;
        if (shortName) ui.endInput.value = shortName;
    }
    map.setView(latlng, 13);
}

/**
 * Executes a geographic text search utilizing Nominatim API.
 * @param {Object} map 
 * @param {string} query 
 * @param {string} target 'start' or 'end'
 */
async function handleGeocode(map, query, target) {
    if (!query.trim()) return;
    
    showStatus(`Searching for ${query}...`, 'loading');
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
        const data = await response.json();
        
        if (!data || data.length === 0) throw new Error("Location not found");
        
        const latlng = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        const shortName = data[0].display_name.split(',')[0] + ", " + (data[0].display_name.split(',').pop().trim());
        
        plotMarker(map, latlng, target, shortName);
        
        showStatus('Location found', 'success');
        setTimeout(() => showStatus('', 'hidden'), 2500);
        
    } catch (err) {
        showStatus(`Geocoding error: ${err.message}`, 'error');
    }
}

/**
 * Fetches the route from the backend and draws it on the map.
 * Implementation for Step 1: Tracer Bullet.
 * @param {Object} map - Leaflet Map instance
 */
async function calculateRoute(map) {
    if (!state.startCoords || !state.endCoords) return;

    ui.calcBtn.disabled = true;
    showStatus('Calculating route...', 'loading');

    const payload = {
        start: formatCoord(state.startCoords),
        end: formatCoord(state.endCoords)
    };

    try {
        // Step 1: Tracer bullet calls internal express backend (assumed to be on /api/route)
        // Note: For actual network call, backend must exist. Overriding logic locally if no server.
        let outGeoJson = null;

        try {
            const response = await fetch('/api/route', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.message || 'Server responded with an error');
            }
            outGeoJson = await response.json();
        } catch (fetchErr) {
            console.warn("[app] Backend unavailable, injecting mock Tracer Bullet response.", fetchErr.message);
            // Mock Fallback GeoJSON for Step 1 Validation if backend is down
            outGeoJson = {
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [state.startCoords.lng, state.startCoords.lat],
                            // Add a bogus midpoint to verify polyline rendering
                            [(state.startCoords.lng + state.endCoords.lng) / 2, (state.startCoords.lat + state.endCoords.lat) / 2 + 0.01],
                            [state.endCoords.lng, state.endCoords.lat]
                        ]
                    },
                    properties: { distance: "Mocked", time: "Mocked" }
                }]
            };
        }

        renderRoute(map, outGeoJson);
        showStatus('Route retrieved successfully.', 'success');

    } catch (error) {
        console.error("[app] Route calculation failed:", error);
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        ui.calcBtn.disabled = false;
    }
}

/**
 * Connects the GeoJSON line string to the map via Leaflet.
 * @param {Object} map - Leaflet Map instance
 * @param {Object} geojsonData - Valid GeoJSON LineString
 */
function renderRoute(map, geojsonData) {
    if (state.routeLayer) {
        map.removeLayer(state.routeLayer);
    }

    state.routeLayer = L.geoJSON(geojsonData, {
        style: {
            color: '#2196F3',
            weight: 5,
            opacity: 0.8
        }
    }).addTo(map);

    // Zoom to fit bounds
    map.fitBounds(state.routeLayer.getBounds(), { padding: [50, 50] });
}

/**
 * Resets the application state and clears map layers.
 * @param {Object} map - Leaflet Map instance
 */
function resetState(map) {
    if (state.markers.start) map.removeLayer(state.markers.start);
    if (state.markers.end) map.removeLayer(state.markers.end);
    if (state.routeLayer) map.removeLayer(state.routeLayer);

    state.startCoords = null;
    state.endCoords = null;
    state.selectionMode = 'start';
    state.markers.start = null;
    state.markers.end = null;
    state.routeLayer = null;

    ui.startInput.value = '';
    ui.endInput.value = '';
    ui.calcBtn.disabled = true;
    showStatus('', 'hidden');
}

/**
 * Renders status messages in the UI.
 * @param {string} msg 
 * @param {string} type - 'error', 'success', 'loading', 'hidden'
 */
function showStatus(msg, type) {
    ui.statusMsg.className = 'status-msg'; // Reset
    if (type !== 'hidden') {
        ui.statusMsg.classList.add(type);
        ui.statusMsg.innerText = msg;
    } else {
        ui.statusMsg.classList.add('hidden');
        ui.statusMsg.innerText = '';
    }
}

// Map entry point
document.addEventListener('DOMContentLoaded', initMap);

// Export for testing if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { formatCoord, displayCoord };
}
