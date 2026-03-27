/**
 * @fileoverview Frontend Application Logic for AI Route Planner
 * Handles Leaflet map initialization, user interactions, and backend API routing data visualization.
 */

// Config constants for easy editing
const appConfig = {
    debounceTimeMs: 800, // The time to wait before querying Nominatim after user stops typing
    DEBUG: true // Universal constant for detailed logging
};

/**
 * Universal logging utility
 */
const logDebug = (funcName, action, data) => {
    if (appConfig.DEBUG) {
        console.log(`[DEBUG] [${funcName}] ${action}`, data !== undefined ? data : '');
    }
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
const formatCoord = (coords) => {
    logDebug('formatCoord', 'ENTRY', { coords });
    const result = { lat: coords.lat, lng: coords.lng };
    logDebug('formatCoord', 'EXIT', result);
    return result;
};

/**
 * Formats a coordinate to a display string
 * @param {Object} coord - {lat, lng}
 * @returns {string} lat,lng truncated
 */
const displayCoord = (coord) => {
    logDebug('displayCoord', 'ENTRY', { coord });
    const result = `${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`;
    logDebug('displayCoord', 'EXIT', result);
    return result;
};

/**
 * Initializes the Leaflet map and event handlers.
 */
function initMap() {
    logDebug('initMap', 'ENTRY');
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
            logDebug('initMap', 'GEOLOCATION_REQUEST');
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const userCoords = [pos.coords.latitude, pos.coords.longitude];
                    logDebug('initMap', 'GEOLOCATION_SUCCESS', { userCoords });
                    map.setView(userCoords, 13);
                },
                (err) => {
                    logDebug('initMap', 'GEOLOCATION_ERROR_OR_DENIED', { error: err.message || err });
                    console.warn("[app] Geolocation skipped or denied.");
                }
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
        logDebug('initMap', 'EXIT_SUCCESS');
    } catch (err) {
        logDebug('initMap', 'ERROR', { message: err.message, stack: err.stack });
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
    logDebug('handleMapClick', 'ENTRY', { latlng, currentMode: state.selectionMode });

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
        
        logDebug('handleMapClick', 'EXIT_START_SET', { startCoords: state.startCoords, newMode: state.selectionMode });

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

        logDebug('handleMapClick', 'EXIT_END_SET', { endCoords: state.endCoords, newMode: state.selectionMode });
    } else {
        logDebug('handleMapClick', 'EXIT_NO_ACTION', { currentMode: state.selectionMode });
    }
}

/**
 * Configures the typing timer (debounce) and spacebar triggers for the autocomplete inputs.
 * @param {Object} map 
 * @param {string} target 'start' or 'end'
 */
function setupAutocompleteInput(map, target) {
    logDebug('setupAutocompleteInput', 'ENTRY', { target });
    
    const inputEl = target === 'start' ? ui.startInput : ui.endInput;
    const dropdownEl = target === 'start' ? ui.startSuggestions : ui.endSuggestions;

    inputEl.addEventListener('input', (e) => {
        const query = e.target.value;
        logDebug('setupAutocompleteInput_InputListener', 'INPUT_RECEIVED', { target, query });

        if (!query.trim() || query.length < 3) {
            dropdownEl.classList.add('hidden');
            dropdownEl.innerHTML = '';
            if (state.debounceTimers[target]) {
                clearTimeout(state.debounceTimers[target]);
                logDebug('setupAutocompleteInput_InputListener', 'TIMER_CLEARED');
            }
            return;
        }

        const lastChar = query[query.length - 1];
        
        if (state.debounceTimers[target]) {
            clearTimeout(state.debounceTimers[target]);
        }

        if (lastChar === ' ') {
            logDebug('setupAutocompleteInput_InputListener', 'TRIGGER_FETCH_IMMEDIATE', { query: query.trim() });
            fetchSuggestions(map, query.trim(), target, dropdownEl);
        } else {
            logDebug('setupAutocompleteInput_InputListener', 'TRIGGER_FETCH_DEBOUNCED', { target, delayMs: appConfig.debounceTimeMs });
            state.debounceTimers[target] = setTimeout(() => {
                fetchSuggestions(map, query.trim(), target, dropdownEl);
            }, appConfig.debounceTimeMs);
        }
    });

    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            logDebug('setupAutocompleteInput_KeydownListener', 'ENTER_PRESSED', { target, value: inputEl.value });
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

    logDebug('setupAutocompleteInput', 'EXIT_SUCCESS', { target });
}

/**
 * Executes a geographic text search for dropdown suggestions.
 */
async function fetchSuggestions(map, query, target, dropdownEl) {
    logDebug('fetchSuggestions', 'ENTRY', { query, target });
    if (!query) {
        logDebug('fetchSuggestions', 'EXIT_NO_QUERY');
        return;
    }
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
        logDebug('fetchSuggestions', 'API_REQUEST', { url });
        
        const response = await fetch(url);
        logDebug('fetchSuggestions', 'API_RESPONSE', { status: response.status });
        
        const data = await response.json();
        logDebug('fetchSuggestions', 'API_DATA', { resultCount: data ? data.length : 0 });

        dropdownEl.innerHTML = '';
        if (data && data.length > 0) {
            dropdownEl.classList.remove('hidden');
            data.forEach(item => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.innerText = item.display_name;
                div.addEventListener('click', () => {
                    logDebug('fetchSuggestions_SuggestionClick', 'ENTRY', { display_name: item.display_name, lat: item.lat, lon: item.lon });
                    
                    const latlng = { lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
                    const shortName = item.display_name.split(',')[0] + ", " + (item.display_name.split(',').pop().trim());
                    
                    const inputEl = target === 'start' ? ui.startInput : ui.endInput;
                    inputEl.value = shortName;
                    dropdownEl.classList.add('hidden');
                    
                    plotMarker(map, latlng, target, shortName);
                    logDebug('fetchSuggestions_SuggestionClick', 'EXIT_SUCCESS');
                });
                dropdownEl.appendChild(div);
            });
            logDebug('fetchSuggestions', 'EXIT_SUGGESTIONS_RENDERED');
        } else {
            dropdownEl.classList.add('hidden');
            logDebug('fetchSuggestions', 'EXIT_NO_RESULTS');
        }
    } catch (err) {
        logDebug('fetchSuggestions', 'ERROR', { message: err.message, stack: err.stack });
        console.error("[app] Autocomplete error:", err);
    }
}

/**
 * Universal marker plotter.
 */
function plotMarker(map, latlng, target, shortName) {
    logDebug('plotMarker', 'ENTRY', { latlng, target, shortName });
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
    logDebug('plotMarker', 'EXIT_SUCCESS', { selectionMode: state.selectionMode });
}

/**
 * Executes a geographic text search utilizing Nominatim API.
 * @param {Object} map 
 * @param {string} query 
 * @param {string} target 'start' or 'end'
 */
async function handleGeocode(map, query, target) {
    logDebug('handleGeocode', 'ENTRY', { query, target });
    if (!query.trim()) {
        logDebug('handleGeocode', 'EXIT_NO_QUERY');
        return;
    }
    
    showStatus(`Searching for ${query}...`, 'loading');
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
        logDebug('handleGeocode', 'API_REQUEST', { url });

        const response = await fetch(url);
        logDebug('handleGeocode', 'API_RESPONSE', { status: response.status });

        const data = await response.json();
        logDebug('handleGeocode', 'API_DATA', { resultCount: data ? data.length : 0 });
        
        if (!data || data.length === 0) throw new Error("Location not found");
        
        const latlng = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        const shortName = data[0].display_name.split(',')[0] + ", " + (data[0].display_name.split(',').pop().trim());
        
        plotMarker(map, latlng, target, shortName);
        
        showStatus('Location found', 'success');
        setTimeout(() => showStatus('', 'hidden'), 2500);
        
        logDebug('handleGeocode', 'EXIT_SUCCESS');
    } catch (err) {
        logDebug('handleGeocode', 'ERROR', { message: err.message, stack: err.stack });
        showStatus(`Geocoding error: ${err.message}`, 'error');
    }
}

/**
 * Fetches the route from the backend and draws it on the map.
 * Implementation for Step 1: Tracer Bullet.
 * @param {Object} map - Leaflet Map instance
 */
async function calculateRoute(map) {
    logDebug('calculateRoute', 'ENTRY');
    if (!state.startCoords || !state.endCoords) {
        logDebug('calculateRoute', 'EXIT_MISSING_COORDS', { start: !!state.startCoords, end: !!state.endCoords });
        return;
    }

    ui.calcBtn.disabled = true;
    showStatus('Calculating route...', 'loading');

    const payload = {
        start: formatCoord(state.startCoords),
        end: formatCoord(state.endCoords)
    };

    try {
        const fetchUrl = 'http://localhost:3000/api/routes/calculate';
        logDebug('calculateRoute', 'API_REQUEST', { method: 'POST', url: fetchUrl, payload });
        
        const response = await fetch(fetchUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        logDebug('calculateRoute', 'API_RESPONSE_STATUS', { status: response.status, ok: response.ok });

        if (!response.ok) {
            let errorMsg = `HTTP Error ${response.status}`;
            try {
                const errData = await response.json();
                logDebug('calculateRoute', 'API_ERROR_DATA', errData);
                errorMsg = errData.message || errData.error || errorMsg;
            } catch (e) {
                // Not JSON, just use generic HTTP status error
                logDebug('calculateRoute', 'API_ERROR_PARSE_FAIL', { message: e.message });
            }
            throw new Error(errorMsg);
        }

        const data = await response.json();
        logDebug('calculateRoute', 'API_RESPONSE_DATA', data);
        
        if (!data.success || !data.data || !data.data.path) {
            throw new Error('Invalid response format from server');
        }

        renderRoute(map, data.data.path);
        showStatus('Route retrieved successfully.', 'success');
        logDebug('calculateRoute', 'EXIT_SUCCESS');

    } catch (error) {
        logDebug('calculateRoute', 'ERROR', { message: error.message, stack: error.stack });
        console.error("[app] Route calculation failed:", error);
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        ui.calcBtn.disabled = false;
        logDebug('calculateRoute', 'FINALLY_CALCBTN_UNLOCKED');
    }
}

/**
 * Connects the array of coordinates to the map via Leaflet Polyline.
 * @param {Object} map - Leaflet Map instance
 * @param {Array} pathCoords - Array of {lat, lng} coordinate objects
 */
function renderRoute(map, pathCoords) {
    logDebug('renderRoute', 'ENTRY', { pathCoordsLength: pathCoords.length });
    
    if (state.routeLayer) {
        map.removeLayer(state.routeLayer);
        logDebug('renderRoute', 'REMOVED_EXISTING_LAYER');
    }

    // Convert {lat, lng} objects to [lat, lng] arrays for Leaflet
    const latLngPairs = pathCoords.map(coord => [coord.lat, coord.lng]);

    state.routeLayer = L.polyline(latLngPairs, {
        color: '#2196F3',
        weight: 5,
        opacity: 0.8
    }).addTo(map);

    // Zoom to fit bounds if there are points
    if (latLngPairs.length > 0) {
        map.fitBounds(state.routeLayer.getBounds(), { padding: [50, 50] });
        logDebug('renderRoute', 'FITTED_BOUNDS');
    }
    
    logDebug('renderRoute', 'EXIT_SUCCESS');
}

/**
 * Resets the application state and clears map layers.
 * @param {Object} map - Leaflet Map instance
 */
function resetState(map) {
    logDebug('resetState', 'ENTRY');
    
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
    
    logDebug('resetState', 'EXIT_SUCCESS');
}

/**
 * Renders status messages in the UI.
 * @param {string} msg 
 * @param {string} type - 'error', 'success', 'loading', 'hidden'
 */
function showStatus(msg, type) {
    logDebug('showStatus', 'ENTRY', { msg, type });
    ui.statusMsg.className = 'status-msg'; // Reset
    if (type !== 'hidden') {
        ui.statusMsg.classList.add(type);
        ui.statusMsg.innerText = msg;
    } else {
        ui.statusMsg.classList.add('hidden');
        ui.statusMsg.innerText = '';
    }
    logDebug('showStatus', 'EXIT_SUCCESS');
}

// Map entry point
document.addEventListener('DOMContentLoaded', () => {
    logDebug('DOMContentLoaded', 'ENTRY');
    initMap();
    logDebug('DOMContentLoaded', 'EXIT');
});

// Export for testing if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { formatCoord, displayCoord };
}
