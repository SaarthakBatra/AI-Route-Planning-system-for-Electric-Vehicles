/**
 * @fileoverview AI Route Planner - Frontend Core Orchestrator
 *
 * WORKFLOW & INTERACTION LIFECYCLE:
 * 1. INITIALIZATION: DOMContentLoaded triggers initMap(), loading Leaflet and setting up event listeners.
 * 2. GEOLOCATION: The browser attempts to center the map on the user's location via navigator.geolocation.
 * 3. COORDINATE SELECTION: Users click the map (handleMapClick) or search textually (handleGeocode/fetchSuggestions).
 * 4. API ORCHESTRATION: calculateRoute() sends a POST request with start/end coordinates to the backend.
 * 5. VISUALIZATION: renderAllRoutes() processes the multi-algorithm response, creating pixel-space polyline bundles.
 * 6. TELEMETRY: spawnAlgorithmToasts() generates glassmorphic result cards with hover-sync highlighting.
 *
 * @author Antigravity
 * @version 1.3.0
 */

/**
 * Global Configuration Tokens
 * @type {Object}
 */
const appConfig = {
    // Dynamic API Base URL detection:
    // If running on localhost (Local Dev), default to targeting the backend on port 3000.
    // If running in production (Unified Host), use a relative root path.
    apiBaseUrl: (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                ? 'http://localhost:3000'
                : '',
    apiEndpoint: '/api/routes/calculate',
    debounceTimeMs: 800,
    popupMinimizeTimer: 60000,
    DEBUG: true,
    algoColors: {
        'BFS': '#2196F3',
        'Dijkstra': '#9C27B0',
        'IDDFS': '#FF9800',
        'A*': '#10B981',
        'IDA*': '#FBBF24'
    },
    baseWeight: 10
};

/**
 * Centralized telemetry logger for development debugging.
 * @param {string} funcName - Originating function name.
 * @param {string} action - Triggered action or milestone.
 * @param {any} [data] - Related payload or error object.
 */
const logDebug = (funcName, action, data) => {
    if (appConfig.DEBUG) {
        console.log(`[DEBUG] [${funcName}] ${action}`, data !== undefined ? data : '');
    }
};

/**
 * Reactive Application State
 * @type {Object}
 */
const state = {
    startCoords: null,
    endCoords: null,
    selectionMode: 'start',
    routeLayers: [],
    originalStyles: new Map(), // Stores { algorithm: { latLngs, weight, offset, color } }
    markers: {
        start: null,
        end: null,
        chargers: []
    },
    debounceTimers: {
        start: null,
        end: null
    },
    // Stage 5 EV States
    evEnabled: false,
    evParams: {
        vehicle_mass_kg: 1800,
        battery_capacity_kwh: 60,
        drag_coeff: 0.23,
        frontal_area_m2: 2.22,
        crr: 0.012,
        wheel_radius_m: 0.35,
        regen_efficiency: 0.75,
        max_regen_power_kw: 60.0,
        aux_power_kw: 0.5,
        ac_kw_max: 11.0,
        dc_kw_max: 250.0,
        energy_uncertainty_margin_pct: 5.0
    },
    tripHistory: {
        plannedWaypoints: [],
        actualLogs: new Map(), // waypointId -> actualSoC
        selectedWaypoint: null
    }
};

/**
 * OEM Vehicle Presets (Stage 5 Physics)
 */
const vehiclePresets = {
    tesla_3: {
        name: 'Tesla Model 3',
        mass_kg: 1750,
        capacity_kwh: 60,
        drag_coeff: 0.23,
        frontal_area: 2.22,
        crr: 0.012,
        wheel_radius: 0.35,
        ac_max: 11,
        dc_max: 170,
        regen_max: 60,
        regen_eff: 0.75,
        aux: 0.5
    },
    tesla_y: {
        name: 'Tesla Model Y',
        mass_kg: 1950,
        capacity_kwh: 75,
        drag_coeff: 0.24,
        frontal_area: 2.54,
        crr: 0.012,
        wheel_radius: 0.38,
        ac_max: 11,
        dc_max: 250,
        regen_max: 75,
        regen_eff: 0.80,
        aux: 0.7
    },
    rivian_r1t: {
        name: 'Rivian R1T',
        mass_kg: 3150,
        capacity_kwh: 135,
        drag_coeff: 0.30,
        frontal_area: 3.2,
        crr: 0.015,
        wheel_radius: 0.45,
        ac_max: 11,
        dc_max: 210,
        regen_max: 100,
        regen_eff: 0.70,
        aux: 1.2
    },
    standard_sedan: {
        name: 'Standard Sedan',
        mass_kg: 1800,
        capacity_kwh: 60,
        drag_coeff: 0.28,
        frontal_area: 2.4,
        crr: 0.012,
        wheel_radius: 0.35,
        ac_max: 11,
        dc_max: 150,
        regen_max: 50,
        regen_eff: 0.75,
        aux: 0.6
    }
};

// Map configuration
const mapConfig = {
    initialCenter: [37.7749, -122.4194], // Default: San Francisco
    initialZoom: 10,
    defaultTheme: 'light', // OPTIONS: 'light', 'dark', 'satellite'
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    tiles: {
        dark: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png',
        light: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    }
};

// DOM Elements
const ui = {
    startInput: document.getElementById('start-input'),
    endInput: document.getElementById('end-input'),
    objectiveSelect: document.getElementById('objective-select'),
    hourSlider: document.getElementById('hour-slider'),
    hourDisplay: document.getElementById('hour-display'),
    calcBtn: document.getElementById('calc-route-btn'),
    resetBtn: document.getElementById('reset-btn'),
    statusMsg: document.getElementById('status-message'),
    startSuggestions: document.getElementById('start-suggestions'),
    endSuggestions: document.getElementById('end-suggestions'),
    routeInfo: document.getElementById('route-info'),
    routeDistance: document.getElementById('route-distance'),
    routeDuration: document.getElementById('route-duration'),
    notificationsContainer: document.getElementById('notifications-container'),
    
    // EV Logic UI
    evToggle: document.getElementById('ev-routing-toggle'),
    evParamsPanel: document.getElementById('ev-params-panel'),
    vehiclePreset: document.getElementById('vehicle-preset'),
    startSoc: document.getElementById('start-soc'),
    batterySoh: document.getElementById('battery-soh'),
    payloadSlider: document.getElementById('payload-slider'),
    payloadDisplay: document.getElementById('payload-display'),
    ambientTemp: document.getElementById('ambient-temp'),
    targetCharge: document.getElementById('target-charge'),
    ecoSlider: document.getElementById('eco-slider'),
    ecoDisplay: document.getElementById('eco-display'),
    
    // Advanced Physics UI
    dragCoeff: document.getElementById('drag-coeff'),
    frontalArea: document.getElementById('frontal-area'),
    crrCoeff: document.getElementById('crr-coeff'),
    wheelRadius: document.getElementById('wheel-radius'),
    minWaypointSoc: document.getElementById('min-waypoint-soc'),
    minArrivalSoc: document.getElementById('min-arrival-soc'),
    regenEff: document.getElementById('regen-efficiency'),
    auxPower: document.getElementById('aux-power'),
    missionChargeBound: document.getElementById('mission-charge-bound'),
    emergencyMode: document.getElementById('emergency-mode'),
    
    // Trip Execution Panel
    tripPanel: document.getElementById('trip-execution-panel'),
    loggerInputs: document.getElementById('logger-inputs'),
    actualSocInput: document.getElementById('actual-soc-input'),
    logSocBtn: document.getElementById('log-soc-btn'),
    deviationValue: document.getElementById('deviation-value'),
    deviationReadout: document.getElementById('deviation-readout'),
    recomputeBtn: document.getElementById('recompute-btn')
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
 * Formats distance in meters to a human-readable string.
 * @param {number} meters 
 * @returns {string}
 */
const formatDistance = (meters) => {
    if (meters >= 1000) {
        return (meters / 1000).toFixed(1) + ' km';
    }
    return Math.round(meters) + ' m';
};

/**
 * Formats duration in seconds to a human-readable string.
 * Supports seconds, minutes, and hour/minute combinations.
 * @param {number} seconds - Raw duration in seconds.
 * @returns {string} Human-readable time (e.g., '1 hr 5 mins').
 */
const formatDuration = (seconds) => {
    if (seconds < 60) return Math.round(seconds) + ' secs';
    const mins = Math.floor(seconds / 60);
    const hours = Math.floor(mins / 60);
    if (hours > 0) {
        return `${hours} hr ${mins % 60} min`;
    }
    return `${mins} mins`;
};

/**
 * Initializes the Leaflet map and event handlers.
 */
function initMap() {
    logDebug('initMap', 'ENTRY');
    try {
        const map = L.map('map', { zoomControl: false }).setView(mapConfig.initialCenter, mapConfig.initialZoom);

        // Map Themes
        const darkTheme = L.tileLayer(mapConfig.tiles.dark, {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap &copy; CartoDB'
        });

        const lightTheme = L.tileLayer(mapConfig.tiles.light, {
            maxZoom: 19,
            attribution: mapConfig.attribution
        });

        const satelliteTheme = L.tileLayer(mapConfig.tiles.satellite, {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri'
        });

        const baseMaps = {
            'Dark Theme': darkTheme,
            'Light Theme': lightTheme,
            'Satellite': satelliteTheme
        };

        // Set default theme from config
        if (mapConfig.defaultTheme === 'dark') darkTheme.addTo(map);
        else if (mapConfig.defaultTheme === 'satellite') satelliteTheme.addTo(map);
        else lightTheme.addTo(map);

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
                    console.warn('[app] Geolocation skipped or denied.');
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

        // Hour Slider Listener
        ui.hourSlider.addEventListener('input', (e) => {
            ui.hourDisplay.innerText = e.target.value;
        });

        // Initialize EV Mission Control Handlers
        initEVHandlers(map);

        console.log('[app] Map initialized successfully.');
        logDebug('initMap', 'EXIT_SUCCESS');
    } catch (err) {
        logDebug('initMap', 'ERROR', { message: err.message, stack: err.stack });
        console.error('[app] Map initialization failed:', err);
        showStatus('Critical error: Could not load the map interface.', 'error');
    }
}

/**
 * Initializes listeners for EV-specific UI elements.
 * @param {Object} map 
 */
function initEVHandlers(map) {
    logDebug('initEVHandlers', 'ENTRY');

    // EV Master Toggle
    ui.evToggle.addEventListener('change', (e) => {
        state.evEnabled = e.target.checked;
        ui.evParamsPanel.classList.toggle('hidden', !state.evEnabled);
        logDebug('evToggle', 'CHANGED', { enabled: state.evEnabled });
    });

    // Vehicle Preset Selection
    ui.vehiclePreset.addEventListener('change', (e) => {
        applyVehiclePreset(e.target.value);
    });

    // Payload Slider
    ui.payloadSlider.addEventListener('input', (e) => {
        ui.payloadDisplay.innerText = e.target.value;
    });

    // Eco Slider
    ui.ecoSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        let label = 'Balanced';
        if (val < 30) label = 'Max Efficiency';
        else if (val < 45) label = 'Eco-Friendly';
        else if (val > 75) label = 'Max Performance';
        else if (val > 55) label = 'Time-Optimized';
        ui.ecoDisplay.innerText = label;
    });

    // Log SoC Button
    ui.logSocBtn.addEventListener('click', () => {
        logActualSoC(map);
    });

    // Recompute Button
    ui.recomputeBtn.addEventListener('click', () => {
        triggerConservativeRecompute(map);
    });

    logDebug('initEVHandlers', 'EXIT_SUCCESS');
}

/**
 * Updates UI and internal state based on selected OEM profile.
 * @param {string} presetKey 
 */
function applyVehiclePreset(presetKey) {
    logDebug('applyVehiclePreset', 'ENTRY', { presetKey });
    if (presetKey === 'custom') return;

    const preset = vehiclePresets[presetKey];
    if (!preset) return;

    // Update state
    state.evParams.vehicle_mass_kg = preset.mass_kg;
    state.evParams.battery_capacity_kwh = preset.capacity_kwh;
    state.evParams.drag_coeff = preset.drag_coeff;
    state.evParams.frontal_area_m2 = preset.frontal_area;
    state.evParams.crr = preset.crr;
    state.evParams.wheel_radius_m = preset.wheel_radius;
    state.evParams.ac_kw_max = preset.ac_max;
    state.evParams.dc_kw_max = preset.dc_max;
    state.evParams.max_regen_power_kw = preset.regen_max;
    state.evParams.regen_efficiency = preset.regen_eff;
    state.evParams.aux_power_kw = preset.aux;

    // Update UI
    ui.dragCoeff.value = preset.drag_coeff;
    ui.frontalArea.value = preset.frontal_area;
    ui.crrCoeff.value = preset.crr;
    ui.wheelRadius.value = preset.wheel_radius;
    ui.regenEff.value = Math.round(preset.regen_eff * 100);
    ui.auxPower.value = preset.aux;

    logDebug('applyVehiclePreset', 'EXIT_SUCCESS', preset.name);
}

/**
 * Handles map click logic for selecting start/end points.
 * Automatically toggles between selection modes and updates the UI markers.
 * @param {Object} map - Leaflet Map instance.
 * @param {Object} latlng - Click coordinates {lat, lng}.
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
            fillColor: '#4CAF50',
            color: '#fff',
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
            fillColor: '#F44336',
            color: '#fff',
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
 * Shared utility for Nominatim API fetching to reduce code redundancy.
 * @private
 * @param {string} query - The address search string.
 * @param {number} limit - Max results to return.
 * @returns {Promise<Array>} Collection of location objects.
 */
async function _fetchNominatim(query, limit = 5) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=${limit}&q=${encodeURIComponent(query)}`;
    logDebug('_fetchNominatim', 'API_REQUEST', { url });
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Geocoding service error: ${response.status}`);
    
    const data = await response.json();
    logDebug('_fetchNominatim', 'API_RESPONSE', { count: data.length });
    return data;
}

/**
 * Executes a geographic text search for dropdown suggestions via Nominatim.
 * @param {Object} map - Leaflet Map instance.
 * @param {string} query - Search string.
 * @param {string} target - Selection target ('start'|'end').
 * @param {HTMLElement} dropdownEl - UI suggestion container.
 * @returns {Promise<void>}
 */
async function fetchSuggestions(map, query, target, dropdownEl) {
    logDebug('fetchSuggestions', 'ENTRY', { query, target });
    if (!query) return;

    try {
        const data = await _fetchNominatim(query, 5);
        dropdownEl.innerHTML = '';
        
        if (data && data.length > 0) {
            dropdownEl.classList.remove('hidden');
            data.forEach(item => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.innerText = item.display_name;
                div.addEventListener('click', () => {
                    logDebug('fetchSuggestions_SuggestionClick', 'ENTRY', { display_name: item.display_name });
                    const latlng = { lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
                    const shortName = item.display_name.split(',')[0] + ', ' + (item.display_name.split(',').pop().trim());

                    plotMarker(map, latlng, target, shortName);
                    dropdownEl.classList.add('hidden');
                });
                dropdownEl.appendChild(div);
            });
        } else {
            dropdownEl.classList.add('hidden');
        }
    } catch (err) {
        logDebug('fetchSuggestions', 'ERROR', err.message);
        console.error('[app] Autocomplete error:', err);
    }
}

/**
 * Universal marker plotter for both map clicks and search selections.
 * @param {Object} map - Leaflet Map instance.
 * @param {Object} latlng - Coordinates {lat, lng}.
 * @param {string} target - 'start' or 'end'.
 * @param {string} [shortName] - Display name for the input field.
 */
function plotMarker(map, latlng, target, shortName) {
    logDebug('plotMarker', 'ENTRY', { latlng, target, shortName });
    if (target === 'start') {
        state.startCoords = latlng;
        if (state.markers.start) map.removeLayer(state.markers.start);
        state.markers.start = L.circleMarker(latlng, {
            radius: 8, fillColor: '#4CAF50', color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9
        }).addTo(map);
        state.selectionMode = 'end';
        ui.startInput.classList.remove('active');
        ui.endInput.classList.add('active');
        if (shortName) ui.startInput.value = shortName;
    } else {
        state.endCoords = latlng;
        if (state.markers.end) map.removeLayer(state.markers.end);
        state.markers.end = L.circleMarker(latlng, {
            radius: 8, fillColor: '#F44336', color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9
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
    if (!query.trim()) return;

    showStatus(`Searching for ${query}...`, 'loading');
    try {
        const data = await _fetchNominatim(query, 1);

        if (!data || data.length === 0) throw new Error('Location not found');

        const latlng = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        const shortName = data[0].display_name.split(',')[0] + ', ' + (data[0].display_name.split(',').pop().trim());

        plotMarker(map, latlng, target, shortName);
        showStatus('Location found', 'success');
        setTimeout(() => showStatus('', 'hidden'), 2500);

    } catch (err) {
        logDebug('handleGeocode', 'ERROR', err.message);
        showStatus(`Geocoding error: ${err.message}`, 'error');
    }
}

/**
 * Orchestrates the full route comparison suite by querying the backend.
 * Parses the multi-algorithm response and triggers visualization layers.
 * @param {Object} map - Leaflet Map instance.
 * @returns {Promise<void>}
 */
async function calculateRoute(map) {
    logDebug('calculateRoute', 'ENTRY');
    if (!state.startCoords || !state.endCoords) {
        logDebug('calculateRoute', 'EXIT_MISSING_COORDS', { start: !!state.startCoords, end: !!state.endCoords });
        return;
    }

    ui.calcBtn.disabled = true;
    showStatus('Running comparison suite...', 'loading');

    // Stage 5 EV Mission Control Payload Integration
    const payload = {
        start: formatCoord(state.startCoords),
        end: formatCoord(state.endCoords),
        objective: ui.objectiveSelect.value,
        mock_hour: parseInt(ui.hourSlider.value)
    };

    if (state.evEnabled) {
        payload.ev_params = getEvPayload();
        logDebug('calculateRoute', 'EV_MODE_ACTIVE', payload.ev_params);
    }

    try {
        const fetchUrl = appConfig.apiBaseUrl + appConfig.apiEndpoint;

        // PROJECT REQUIREMENT: Detailed logging for coordinates sent
        console.log('[app] Sending comparison request to API:', JSON.stringify(payload, null, 2));
        logDebug('calculateRoute', 'API_REQUEST', { method: 'POST', url: fetchUrl, payload });

        const response = await fetch(fetchUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        // PROJECT REQUIREMENT: Detailed logging for full response
        logDebug('calculateRoute', 'API_RESPONSE_DATA', data);

        if (!response.ok) {
            // Handle specialized backend error messages (e.g. 504 OSM timeout)
            let errorMsg = data.message || data.error || `HTTP Error ${response.status}`;
            throw new Error(errorMsg);
        }

        if (!data.success || !data.data || !data.data.results) {
            throw new Error('Invalid response format: data.data.results missing');
        }

        const results = data.data.results;

        // Clear previous mission markers
        state.markers.chargers.forEach(m => map.removeLayer(m));
        state.markers.chargers = [];

        renderAllRoutes(map, results);
        spawnAlgorithmToasts(results);

        // Update primary UI with the first result (usually best)
        if (results.length > 0) {
            ui.routeDistance.innerText = formatDistance(results[0].distance || 0);
            ui.routeDuration.innerText = formatDuration(results[0].duration || 0);
            ui.routeInfo.classList.remove('hidden');
        }

        showStatus('Comparison complete.', 'success');
        logDebug('calculateRoute', 'EXIT_SUCCESS');

    } catch (error) {
        logDebug('calculateRoute', 'ERROR', { message: error.message, stack: error.stack });
        console.error('[app] Route calculation failed:', error);
        showStatus(`Error: ${error.message}`, 'error');
        ui.routeInfo.classList.add('hidden');
    } finally {
        ui.calcBtn.disabled = false;
        logDebug('calculateRoute', 'FINALLY_CALCBTN_UNLOCKED');
    }
}

/**
 * Constructs the high-fidelity EV physics payload from UI inputs.
 * Performs critical unit conversions (% -> kWh, % -> scalar).
 * @returns {Object} ev_params compatible with Stage 5 Backend/gRPC.
 */
function getEvPayload() {
    logDebug('getEvPayload', 'ENTRY');

    const capacity = parseFloat(state.evParams.battery_capacity_kwh);
    const soh = parseFloat(ui.batterySoh.value) / 100;
    const startSocPct = parseFloat(ui.startSoc.value) / 100;
    
    // Effective Capacity = Capacity * SoH
    const effCapacity = capacity * soh;

    const payload = {
        enabled: true,
        // Physics & Mechanical
        effective_mass_kg: parseFloat(state.evParams.vehicle_mass_kg) + parseFloat(ui.payloadSlider.value),
        drag_coeff: parseFloat(ui.dragCoeff.value),
        frontal_area_m2: parseFloat(ui.frontalArea.value),
        crr: parseFloat(ui.crrCoeff.value),
        wheel_radius_m: parseFloat(ui.wheelRadius.value),
        
        // Battery & Energy
        start_soc_kwh: effCapacity * startSocPct,
        battery_soh_pct: parseFloat(ui.batterySoh.value),
        energy_uncertainty_margin_pct: parseFloat(state.evParams.energy_uncertainty_margin_pct),
        
        // Thresholds (Converted to kWh)
        min_waypoint_soc_kwh: effCapacity * (parseFloat(ui.minWaypointSoc.value) / 100),
        min_arrival_soc_kwh: effCapacity * (parseFloat(ui.minArrivalSoc.value) / 100),
        
        // Power & Charging
        ac_kw_max: parseFloat(state.evParams.ac_kw_max),
        dc_kw_max: parseFloat(state.evParams.dc_kw_max),
        max_regen_power_kw: parseFloat(state.evParams.max_regen_power_kw),
        regen_efficiency: parseFloat(ui.regenEff.value) / 100, // Converted to 0.0-1.0
        target_charge_bound_kwh: parseFloat(ui.missionChargeBound.value) || undefined,
        is_emergency_assumption: ui.emergencyMode.checked,
        
        // Environment & Multi-Objective
        aux_power_kw: parseFloat(ui.auxPower.value),
        ambient_temp_c: parseFloat(ui.ambientTemp.value),
        eco_time_scalar: parseFloat(ui.ecoSlider.value) / 100 // 0.0 (Eco) to 1.0 (Time)
    };

    logDebug('getEvPayload', 'EXIT_SUCCESS', payload);
    return payload;
}

/**
 * Renders all 5 algorithm paths with unique colors and pixel-space stack weights.
 * Handles identical path detection to prevent visual noise.
 * @param {Object} map - Leaflet Map instance.
 * @param {Array<Object>} results - Collection of AlgorithmResult objects.
 */
function renderAllRoutes(map, results) {
    logDebug('renderAllRoutes', 'ENTRY', { count: results.length });

    // Clear existing
    state.routeLayers.forEach(layer => map.removeLayer(layer));
    state.routeLayers = [];
    state.originalStyles.clear();

    // Group results by identical path (polyline coordinates string)
    const pathGroups = new Map();
    results.forEach(res => {
        const pathKey = JSON.stringify(res.polyline);
        if (!pathGroups.has(pathKey)) pathGroups.set(pathKey, []);
        pathGroups.get(pathKey).push(res);
    });

    const TOTAL_BUNDLE_WIDTH = 10;
    const featureGroup = L.featureGroup();

    pathGroups.forEach((group, pathKey) => {
        const N = group.length;
        const perLineWidth = TOTAL_BUNDLE_WIDTH / N;
        const baseLatLngs = JSON.parse(pathKey).map(c => [c.lat, c.lng]);
        const pathData = JSON.parse(pathKey); // Access extra properties like cost_e

        group.forEach((res, index) => {
            const color = appConfig.algoColors[res.algorithm] || '#fff';
            const offsetPx = (index - (N - 1) / 2) * perLineWidth;

            const latLngs = (offsetPx === 0) ? baseLatLngs : getOffsetPoints(map, baseLatLngs, offsetPx);

            // Stage 5: Segment-Aware Regenerative Braking Visualization
            // We split the polyline into solid (consumption) and dashed (regeneration) segments.
            const segments = splitPolylineIntoSegments(pathData, latLngs);
            const algorithmLayers = [];

            segments.forEach(seg => {
                const layer = L.polyline(seg.points, {
                    color: color,
                    weight: perLineWidth,
                    opacity: 0.9,
                    lineJoin: 'round',
                    dashArray: seg.isRegen ? '5, 10' : null,
                    interactive: false
                }).addTo(map);
                
                algorithmLayers.push(layer);
                state.routeLayers.push(layer);
                featureGroup.addLayer(layer);
            });

            // Stage 5: Charger Marker Ontology
            // Only the first result (primary) plots charger markers to avoid clutter.
            if (index === 0 && state.evEnabled) {
                renderChargerMarkers(map, pathData);
            }

            // Store for hover logic
            state.originalStyles.set(res.algorithm, {
                layers: algorithmLayers,
                baseLatLngs: baseLatLngs,
                weight: perLineWidth,
                offsetPx: offsetPx,
                color: color
            });
        });
    });

    if (state.routeLayers.length > 0) {
        map.fitBounds(featureGroup.getBounds(), { padding: [50, 50] });
    }

    // Refresh offsets on zoom to keep bundle pixel-perfect
    map.off('zoomend', refreshRouteOffsets).on('zoomend', refreshRouteOffsets);

    logDebug('renderAllRoutes', 'EXIT_SUCCESS');
}

/**
 * Re-calculates offsets on zoom to maintain 10px bundle size
 */
function refreshRouteOffsets() {
    const map = state.routeLayers[0]?._map;
    if (!map) return;
    state.originalStyles.forEach((style, _algo) => {
        if (style.offsetPx !== 0) {
            const newLatLngs = getOffsetPoints(map, style.baseLatLngs, style.offsetPx);
            
            // Re-segment the new offset points
            // Since we don't have the original pathData metadata here easily, 
            // we'd need to re-segment if we wanted to be perfect.
            // For now, we update the existing layer segments by distributing the new points.
            let pointIdx = 0;
            style.layers.forEach(layer => {
                const count = layer.getLatLngs().length;
                // Note: Leaflet segments share start/end points, so this is an approximation
                // better to re-calculate from scratch using original polyline indices.
                layer.setLatLngs(newLatLngs.slice(pointIdx, pointIdx + count));
                pointIdx += (count - 1);
            });
        }
    });
}

/**
 * Focuses a specific route on hover
 */
function focusRoute(algorithm) {
    const activeStyle = state.originalStyles.get(algorithm);
    if (!activeStyle) return;

    state.originalStyles.forEach((style, algo) => {
        if (algo === algorithm) {
            // Focus this one: full width
            style.layers.forEach(layer => {
                layer.setStyle({ weight: 10, opacity: 1 });
                layer.bringToFront();
            });
        } else {
            // Hide others
            style.layers.forEach(layer => {
                layer.setStyle({ opacity: 0 });
            });
        }
    });
}

/**
 * Renders specialized tri-color ontology markers for charging stops.
 * @param {Object} map 
 * @param {Array<Object>} pathData - Array of coordinates with metadata.
 */
function renderChargerMarkers(map, pathData) {
    logDebug('renderChargerMarkers', 'ENTRY');
    
    pathData.forEach((node, idx) => {
        if (!node.is_charging_stop) return;

        let typeClass = 'unknown'; // 🔵
        let typeName = 'Assumed Compatible';
        
        // Mapping enum-like behavior to UI ontology
        if (node.is_operational === false) {
            typeClass = 'offline'; // ⚪
            typeName = 'Station Offline';
        } else if (node.charger_type === 'DC_FAST') {
            typeClass = 'fast'; // 🟡
            typeName = 'DC Fast Charger';
        } else if (node.charger_type === 'EMERGENCY') {
            typeClass = 'emergency'; // 🔼
            typeName = 'Emergency Wall Plug';
        } else if (node.is_incompatible) {
            typeClass = 'incompatible'; // 🔴
            typeName = 'Incompatible Port';
        }

        // Apply Emergency Context if enabled
        if (ui.emergencyMode.checked && typeClass === 'unknown') {
            typeName = 'Assumed Compatible (Emergency Fallback)';
        }

        const marker = L.circleMarker([node.lat, node.lng], {
            className: `charger-icon ${typeClass}`,
            radius: 8
        }).addTo(map);

        const tooltipContent = `
            <strong>${typeName}</strong><br>
            Power: ${node.kw_output || '?'} kW<br>
            ${node.is_operational === false ? '<span style="color:red">OFFLINE</span>' : 'Operational'}
        `;
        marker.bindTooltip(tooltipContent);

        // Store for execution mode tracking
        marker.on('click', () => {
            state.tripHistory.selectedWaypoint = { id: idx, lat: node.lat, lng: node.lng, plannedPct: node.planned_soc_pct };
            ui.loggerInputs.classList.remove('hidden');
            ui.tripPanel.classList.remove('hidden');
            logDebug('WaypointSelect', 'SELECTED', state.tripHistory.selectedWaypoint);
        });

        state.markers.chargers.push(marker);
    });
}

/**
 * Calculates SoC deviation and triggers recompute alerts.
 */
function logActualSoC(map) {
    const actual = parseFloat(ui.actualSocInput.value);
    const waypoint = state.tripHistory.selectedWaypoint;
    
    if (isNaN(actual) || !waypoint) return;

    const deviation = actual - waypoint.plannedPct;
    ui.deviationValue.innerText = `${deviation > 0 ? '+' : ''}${deviation.toFixed(1)}%`;
    ui.deviationReadout.classList.remove('hidden');

    if (deviation < -2.0) {
        logDebug('logActualSoC', 'CRITICAL_DRAIN_DETECTED', { deviation });
        ui.recomputeBtn.classList.remove('hidden');
        showStatus('Critical drain detected. Suggesting conservative re-calculation.', 'error');
    } else {
        ui.recomputeBtn.classList.add('hidden');
    }
}

/**
 * Triggers a new calculation with inflated uncertainty margin.
 */
function triggerConservativeRecompute(map) {
    logDebug('triggerConservativeRecompute', 'ENTRY');
    state.evParams.energy_uncertainty_margin_pct += 5.0; // Dynamic inflation
    calculateRoute(map);
}

/**
 * Restores original bundle visualization
 */
function restoreRoutes() {
    const map = state.routeLayers[0]?._map;
    state.originalStyles.forEach((style, _algo) => {
        style.layers.forEach(layer => {
            layer.setStyle({
                weight: style.weight,
                opacity: 0.9
            });
        });
    });
}

/**
 * Stage 5 Coordinate-Level Splicing Logic.
 * Groups coordinates into contiguous solid or dashed segments.
 * @param {Array} originalPolyline - Array of coordinate objects with segment_consumed_kwh metadata.
 * @param {Array} renderedLatLngs - Array of already-offset [lat, lng] or L.LatLng for rendering.
 * @returns {Array} List of { isRegen, points } objects.
 */
function splitPolylineIntoSegments(originalPolyline, renderedLatLngs) {
    if (originalPolyline.length < 2) return [];

    const segments = [];
    let currentPoints = [renderedLatLngs[0]];
    let currentIsRegen = (originalPolyline[1]?.segment_consumed_kwh < 0);

    for (let i = 1; i < originalPolyline.length; i++) {
        const consumed = originalPolyline[i].segment_consumed_kwh || 0;
        const isRegen = consumed < 0;

        if (isRegen !== currentIsRegen) {
            // New type discovered, close current segment
            // Seamless stitching: include the current transition point in BOTH segments
            currentPoints.push(renderedLatLngs[i]);
            segments.push({ isRegen: currentIsRegen, points: currentPoints });
            
            // Start next segment with the same point
            currentPoints = [renderedLatLngs[i]];
            currentIsRegen = isRegen;
        } else {
            currentPoints.push(renderedLatLngs[i]);
        }
    }

    // Add final segment
    if (currentPoints.length > 1) {
        segments.push({ isRegen: currentIsRegen, points: currentPoints });
    }

    return segments;
}

/**
 * Helper to offset polyline points in pixel space
 */
function getOffsetPoints(map, points, offset) {
    if (!map || offset === 0) return points;
    
    // Ensure points are [lat, lng] arrays or L.LatLng objects
    const containerPoints = points.map(p => map.latLngToContainerPoint(p));
    const offsetPoints = [];

    for (let i = 0; i < containerPoints.length; i++) {
        let normal = { x: 0, y: 0 };
        let count = 0;

        if (i < containerPoints.length - 1) {
            const p1 = containerPoints[i];
            const p2 = containerPoints[i + 1];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0) {
                normal.x += -dy / len;
                normal.y += dx / len;
                count++;
            }
        }
        if (i > 0) {
            const p1 = containerPoints[i - 1];
            const p2 = containerPoints[i];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0) {
                normal.x += -dy / len;
                normal.y += dx / len;
                count++;
            }
        }

        if (count > 0) {
            const nx = normal.x / count;
            const ny = normal.y / count;
            const nLen = Math.sqrt(nx * nx + ny * ny);
            if (nLen > 0) {
                const offX = (nx / nLen) * offset;
                const offY = (ny / nLen) * offset;
                offsetPoints.push(map.containerPointToLatLng([
                    containerPoints[i].x + offX,
                    containerPoints[i].y + offY
                ]));
            } else {
                offsetPoints.push(points[i]);
            }
        } else {
            offsetPoints.push(points[i]);
        }
    }
    return offsetPoints;
}

/**
 * Spawns concurrent glassmorphic toasts for algorithm performance data.
 */
function spawnAlgorithmToasts(results) {
    logDebug('spawnAlgorithmToasts', 'ENTRY');

    // Clear previous toasts
    ui.notificationsContainer.innerHTML = '';

    results.forEach((res, index) => {
        // Stagger entrance slightly for visual polish
        setTimeout(() => createAlgorithmToast(res), index * 100);
    });
}

/**
 * Creates and appends a single toast notification.
 */
function createAlgorithmToast(data) {
    const toast = document.createElement('div');
    toast.className = 'algorithm-toast';
    
    // PROJECT REQUIREMENT: Detect failure signature
    // 1. LIMIT EXCEEDED: Circuit breaker triggered OR node expansion threshold hit
    // 2. NO PATH FOUND: Backend returns 0 distance and 0 cost for valid regions without routes
    const isBreakerHit = data.circuit_breaker_triggered || data.nodes_expanded > 1000000;
    const isNoPath = !isBreakerHit && data.distance === 0 && data.path_cost === 0;

    if (isBreakerHit) toast.classList.add('breaker-hit');
    if (isNoPath) toast.classList.add('no-path');

    const color = appConfig.algoColors[data.algorithm] || '#ffffff';
    toast.style.setProperty('--algo-accent', color);

    let badge = '';
    if (isBreakerHit) badge = ' <span class="breaker-badge">LIMIT EXCEEDED</span>';
    else if (isNoPath) badge = ' <span class="no-path-badge">NO PATH FOUND</span>';

    // Stage 5: EV-Specific Metrics
    const arrivalSocStr = state.evEnabled ? `${(data.arrival_soc_pct || 0).toFixed(1)}%` : '---';
    const isProximityWarning = state.evEnabled && (data.arrival_soc_pct - parseFloat(ui.minArrivalSoc.value)) < 5.0;

    toast.innerHTML = `
        <div class="toast-header">
            <h3>${data.algorithm}${badge}</h3>
            <div class="toast-controls">
                <button class="minimize-toast" title="Toggle Minimize">▲</button>
                <button class="close-toast" title="Close">&times;</button>
            </div>
        </div>
        <div class="toast-body">
            <div class="toast-stat">
                <span class="label">Nodes Exp</span>
                <span class="value">${data.nodes_expanded.toLocaleString()}</span>
            </div>
            <div class="toast-stat">
                <span class="label">Time</span>
                <span class="value">${data.exec_time_ms}ms</span>
            </div>
            <div class="toast-stat" style="${state.evEnabled ? '' : 'display:none'}">
                <span class="label">Arrival SoC</span>
                <span class="value">${isProximityWarning ? '⚠️ ' : ''}${arrivalSocStr}</span>
            </div>
            <div class="toast-stat" style="${state.evEnabled ? '' : 'display:none'}">
                <span class="label">Energy Cost</span>
                <span class="value">${(isBreakerHit || isNoPath) ? '---' : (data.consumed_kwh || 0).toFixed(2)} kWh</span>
            </div>
            <div class="toast-stat" style="${state.evEnabled ? 'display:none' : ''}">
                <span class="label">Cost</span>
                <span class="value">${(isBreakerHit || isNoPath) ? '---' : data.path_cost.toFixed(2)}</span>
            </div>
            <div class="toast-stat">
                <span class="label">Distance</span>
                <span class="value">${(isBreakerHit || isNoPath) ? '---' : formatDistance(data.distance)}</span>
            </div>
        </div>
    `;

    // Toggle Minimize
    toast.querySelector('.minimize-toast').addEventListener('click', () => {
        toast.classList.toggle('minimized');
    });

    // Manual Close
    toast.querySelector('.close-toast').addEventListener('click', () => {
        destroyToast(toast);
    });

    // Hover Focus Interaction
    toast.addEventListener('mouseenter', () => {
        focusRoute(data.algorithm);
    });

    toast.addEventListener('mouseleave', () => {
        restoreRoutes();
    });

    ui.notificationsContainer.appendChild(toast);

    // Auto-minimize instead of auto-destruct
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('minimized');
        }
    }, appConfig.popupMinimizeTimer);
}

/**
 * Handles toast destruction with animation.
 */
function destroyToast(toast) {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
        if (toast.parentElement) {
            toast.remove();
        }
    });
}

/**
 * Resets the application state and clears map layers.
 * @param {Object} map - Leaflet Map instance
 */
function resetState(map) {
    logDebug('resetState', 'ENTRY');

    if (state.markers.start) map.removeLayer(state.markers.start);
    if (state.markers.end) map.removeLayer(state.markers.end);
    state.routeLayers.forEach(layer => map.removeLayer(layer));
    state.originalStyles.clear();
    map.off('zoomend', refreshRouteOffsets);

    state.startCoords = null;
    state.endCoords = null;
    state.selectionMode = 'start';
    state.markers.start = null;
    state.markers.end = null;
    state.routeLayers = [];
    ui.notificationsContainer.innerHTML = '';

    ui.startInput.value = '';
    ui.endInput.value = '';
    ui.calcBtn.disabled = true;
    ui.routeInfo.classList.add('hidden');
    ui.routeDistance.innerText = '-';
    ui.routeDuration.innerText = '-';
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
    module.exports = { 
        formatCoord, 
        displayCoord, 
        formatDistance, 
        formatDuration,
        applyVehiclePreset,
        getEvPayload,
        initEVHandlers,
        splitPolylineIntoSegments
    };
}
