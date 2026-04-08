/**
 * @file evProfiles.js
 * @module backend/services/evProfiles
 * @description Provides a registry of high-fidelity EV physical coefficients.
 * Supports OEM provenance tracking and follows Stage 5 Development Plan (v11).
 */

const EV_PROFILES = {
    'tesla_model_3': {
        name: 'Tesla Model 3 Long Range',
        profile_source: 'OEM',
        capacity_kwh: 75.0,              // Nominal 
        mass_kg: 1844,                  // Tare
        drag_coeff: 0.23,               // Cd
        frontal_area_m2: 2.22,          // A
        rolling_resistance_coeff: 0.012, // Crr
        wheel_radius_m: 0.35,
        regen_efficiency: 0.85,
        max_regen_power_kw: 60.0,
        aux_power_kw: 0.6,              // HVAC/Infotainment
        ac_kw_max: 11.0,
        dc_kw_max: 250.0,
        supported_ports: ['CCS2', 'NACS', 'TESLA_S', 'IEC_62196_T2']
    },
    'ford_f150_lightning': {
        name: 'Ford F-150 Lightning (Extended Range)',
        profile_source: 'OEM',
        capacity_kwh: 131.0, 
        mass_kg: 3015,                  // Tare
        drag_coeff: 0.44,               // Cd
        frontal_area_m2: 3.8,           // A
        rolling_resistance_coeff: 0.018, // Crr - Truck Tires
        wheel_radius_m: 0.45,
        regen_efficiency: 0.80,
        max_regen_power_kw: 80.0,
        aux_power_kw: 1.2,
        ac_kw_max: 19.2,
        dc_kw_max: 155.0,
        supported_ports: ['CCS1', 'J1772', 'WALL_PLUG']
    },
    'standard_ev': {
        name: 'Standard Generic EV',
        profile_source: 'SYNTHETIC',
        capacity_kwh: 60.0,
        mass_kg: 1800,
        drag_coeff: 0.26,
        frontal_area_m2: 2.3,
        rolling_resistance_coeff: 0.012,
        wheel_radius_m: 0.35,
        regen_efficiency: 0.75,
        max_regen_power_kw: 50.0,
        aux_power_kw: 1.0,
        ac_kw_max: 7.0,
        dc_kw_max: 100.0,
        supported_ports: ['CCS2', 'IEC_62196_T2']
    }
};

/**
 * Retrieves a vehicle profile by ID.
 * @param {string} vehicleId 
 * @returns {Object|null}
 */
const getVehicleProfile = (vehicleId) => {
    return EV_PROFILES[vehicleId] || null;
};

/**
 * Lists all available vehicle profiles.
 * @returns {Array<Object>}
 */
const listProfiles = () => {
    return Object.keys(EV_PROFILES).map(id => ({ id, ...EV_PROFILES[id] }));
};

module.exports = {
    getVehicleProfile,
    listProfiles
};
