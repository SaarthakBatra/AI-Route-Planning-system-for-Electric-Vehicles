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
const database = require('../database');

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

/**
 * Orchestrates the server startup sequence.
 * Ensures that the MongoDB connection is established via the database module
 * BEFORE the Express server begins listening for HTTP requests.
 * 
 * If the connection fails, the process logs a CRITICAL error and exits with code 1.
 */
const startServer = async () => {
    try {
        logger.info('Initializing Backend Startup Sequence...');
        await database.connectMongo();
        
        app.listen(PORT, () => {
            logger.info(`Backend module listening on port ${PORT}`);
        });
    } catch (err) {
        logger.error(`CRITICAL: Server failed to start due to database connection error: ${err.message}`);
        process.exit(1);
    }
};

if (require.main === module) {
    startServer();
}

app.startServer = startServer;
module.exports = app;
