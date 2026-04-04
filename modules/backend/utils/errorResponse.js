/**
 * @file errorResponse.js
 * @module backend/utils/errorResponse
 * @description Standardized REST error response formatter for the backend module.
 * 
 * @param {import('express').Response} res - Express response object
 * @param {number} code - HTTP status code
 * @param {string} message - Descriptive error message
 */
const errorResponse = (res, code, message) => {
    return res.status(code).json({
        error: true,
        code,
        message
    });
};

module.exports = errorResponse;
