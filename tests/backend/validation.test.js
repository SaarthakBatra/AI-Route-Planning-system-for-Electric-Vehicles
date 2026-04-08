/**
 * @file validation.test.js
 * @module tests/backend/validation
 * @description Verifies Joi schema boundaries for physical coefficients (Cd, Mass, etc.).
 */
const { validateEvParams } = require('../../modules/backend/utils/validation');

describe('EV Parameter Validation (Joi)', () => {
    
    it('should pass valid coefficients for Tesla Model 3', () => {
        const data = {
            vehicle_id: 'tesla_model_3',
            payload_kg: 100,
            start_soc_pct: 80,
            battery_soh_pct: 100,
            drag_coeff: 0.23,
            frontal_area_m2: 2.22
        };
        const { error } = validateEvParams(data);
        expect(error).toBeUndefined();
    });

    it('should reject Cd outside [0.1, 0.6]', () => {
        const data = {
            payload_kg: 0,
            start_soc_pct: 50,
            battery_soh_pct: 100,
            drag_coeff: 0.9 // Too high
        };
        const { error } = validateEvParams(data);
        expect(error).toBeDefined();
        expect(error.message).toContain('drag_coeff');
    });

    it('should reject Payload > 2000kg', () => {
        const data = {
            payload_kg: 5000, // Too high
            start_soc_pct: 50,
            battery_soh_pct: 100
        };
        const { error } = validateEvParams(data);
        expect(error).toBeDefined();
        expect(error.message).toContain('payload_kg');
    });

    it('should reject invalid SoC percentages', () => {
        const data = {
            payload_kg: 0,
            start_soc_pct: 150, // Invalid
            battery_soh_pct: 100
        };
        const { error } = validateEvParams(data);
        expect(error).toBeDefined();
        expect(error.message).toContain('start_soc_pct');
    });

    it('should allow optional fields but enforce types', () => {
        const data = {
            payload_kg: 0,
            start_soc_pct: 50,
            battery_soh_pct: 100,
            ambient_temp: "hot" // Invalid type
        };
        const { error } = validateEvParams(data);
        expect(error).toBeDefined();
        expect(error.message).toContain('ambient_temp');
    });

    it('should support the hybrid Stage 5 fields (enabled, effective_mass_kg, start_soc_kwh)', () => {
        const payload = {
            enabled: true,
            effective_mass_kg: 2500,
            start_soc_kwh: 45.5
        };
        const { error, value } = validateEvParams(payload);
        expect(error).toBeUndefined();
        expect(value.enabled).toBe(true);
        expect(value.effective_mass_kg).toBe(2500);
        expect(value.start_soc_kwh).toBe(45.5);
    });

    it('should provide safe mission defaults for non-blocking execution', () => {
        const payload = { enabled: true };
        const { error, value } = validateEvParams(payload);
        
        expect(error).toBeUndefined();
        expect(value.payload_kg).toBe(0);
        expect(value.start_soc_pct).toBe(80);
        expect(value.battery_soh_pct).toBe(100);
    });

    it('should reject invalid types for hybrid fields', () => {
        const payload = {
            effective_mass_kg: 'heavy',
            start_soc_kwh: 'empty'
        };
        const { error } = validateEvParams(payload);
        expect(error).toBeDefined();
    });

    it('should pass and correctly handle nested ev_params structure', () => {
        const data = {
            ev_params: {
                enabled: true,
                payload_kg: 150
            }
        };
        const { error, value } = validateEvParams(data.ev_params);
        expect(error).toBeUndefined();
        expect(value.payload_kg).toBe(150);
        expect(value.enabled).toBe(true);
    });
});
