/**
 * @file validation.js
 * @module backend/utils/validation
 * @description Provides a Joi-based validation schema for EV physical coefficients.
 * Ensures that input parameters (Crr, Cd, Mass) are within realistic physical bounds.
 */
const Joi = require('joi');

/**
 * Schema for EV parameter extraction and validation.
 * Bounds based on typical electric passenger vehicles and light trucks.
 */
const evParamsSchema = Joi.object({
    vehicle_id: Joi.string().optional(),
    ev_routing: Joi.boolean().optional(),
    enabled: Joi.boolean().optional().default(false), // Alias for ev_routing
    
    // Mission Overrides (Physics-First)
    effective_mass_kg: Joi.number().min(500).max(10000).optional(), 
    start_soc_kwh: Joi.number().min(0).max(500).optional(),
    
    // Physics Coefficients (Request Overrides)
    drag_coeff: Joi.number().min(0.1).max(0.6).optional(),        // Default: 0.26
    frontal_area_m2: Joi.number().min(1.0).max(5.0).optional(),   // Default: 2.3
    rolling_resistance_coeff: Joi.number().min(0.005).max(0.05).optional(), // Default: 0.012
    wheel_radius_m: Joi.number().min(0.2).max(0.6).optional(),    // Default: 0.35
    regen_efficiency: Joi.number().min(0.0).max(1.0).optional(),  // Default: 0.75
    aux_power_kw: Joi.number().min(0.0).max(10.0).optional(),     // Default: 1.0
    
    // Mission Specific Parameters
    payload_kg: Joi.number().min(0).max(2000).optional().default(0),
    start_soc_pct: Joi.number().min(0).max(100).optional().default(80),
    battery_soh_pct: Joi.number().min(0).max(100).optional().default(100),
    
    // Constraints
    min_waypoint_soc_pct: Joi.number().min(0).max(100).default(10),
    min_arrival_soc_pct: Joi.number().min(0).max(100).default(20),
    target_charge_bound_pct: Joi.number().min(0).max(100).default(80),
    
    // Thermal & Environment
    target_charge_bound_kwh: Joi.number().min(0).max(500).optional(),
    is_emergency_assumption: Joi.boolean().optional().default(false),
    ambient_temp: Joi.number().min(-40).max(60).optional(),
    energy_uncertainty_margin_pct: Joi.number().min(0).max(50).optional()
}).unknown(true); // Allow other route fields (start, end, etc.)

/**
 * Validates the request body against the EV schema.
 * @param {Object} data - req.body
 * @returns {Object} { value, error }
 */
const validateEvParams = (data) => {
    return evParamsSchema.validate(data, { abortEarly: false });
};

module.exports = {
    validateEvParams
};
