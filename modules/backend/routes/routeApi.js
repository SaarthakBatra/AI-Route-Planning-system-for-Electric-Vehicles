const express = require('express');
const router = express.Router();
const calculateRouteController = require('../controllers/calculateRoute');

router.post('/calculate', calculateRouteController);

module.exports = router;
