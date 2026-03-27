# Controllers Specification

## Purpose
The `controllers/` directory maps 1-to-1 with route endpoints. It handles HTTP request parsing, input validation, calls the service layer if necessary, and returns the strictly formatted JSON response.

## Expected Outcomes
- One function per file.
- All HTTP details (Req, Res, status codes) terminate here.
- Strict JSDoc documentation for incoming parameters.

## How to Check/Test
- Can be unit-tested by mocking the `req` and `res` objects.
- Integration tests verify the HTTP shape of the response.

## Proper Syntax
```javascript
/**
 * Handles calculating a route.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const calculateRouteController = async (req, res) => {
  try {
     // validation and service calling
     return res.status(200).json({ success: true, data: { ... } });
  } catch (error) {
     return errorResponse(res, 500, error.message);
  }
};

module.exports = calculateRouteController;
```
