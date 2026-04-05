/**
 * @file routeApi.js
 * @module backend/routes/routeApi
 * @description Defines REST routing for pathfinding and algorithm comparison.
 * 
 * @workflow
 * 1. Initialize Express Router.
 * 2. Import and register the calculateRouteController.
 * 3. Export router for mounting in the main app.
 */
const express = require('express');
const router = express.Router();
const calculateRouteController = require('../controllers/calculateRoute');

/**
 * @route POST /api/routes/calculate
 * @description Endpoint to calculate a route based on provided coordinates and algorithm preferences.
 * @access Public
 */
router.post('/calculate', calculateRouteController);

module.exports = router;
