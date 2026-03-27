/**
 * Standardized error response formatter.
 * @param {import('express').Response} res 
 * @param {number} code HTTP Status code
 * @param {string} message Error message
 */
const errorResponse = (res, code, message) => {
    return res.status(code).json({
        error: true,
        code,
        message
    });
};

module.exports = errorResponse;
