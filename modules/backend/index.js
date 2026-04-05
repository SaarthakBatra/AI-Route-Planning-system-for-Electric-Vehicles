/**
 * @file index.js
 * @module backend
 * @description Server entry point for the AI Route Planner Backend.
 * Initializes Express middleware, registers routes, and manages lifecycle events.
 * 
 * @workflow
 * 1. Load environment variables from .env.
 * 2. Setup CORS and JSON body-parsing middleware.
 * 3. Register request-based logging context middleware (requestLogger).
 * 4. Mount API routes (/api/routes) and health check endpoints.
 * 5. Start the HTTP server on configured PORT (Default: 3000).
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routeApi = require('./routes/routeApi');
const logger = require('./utils/logger');
const requestLogger = require('./utils/requestLogger');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Universal debug request logging
app.use(requestLogger);

app.use('/api/routes', routeApi);

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP' });
});

if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Backend module listening on port ${PORT}`);
    });
}

module.exports = app;
