# Services Specification

## Purpose
The `services/` directory contains all external interactions and complex business logic. Examples include calling the Redis Cache, pinging the Python gRPC routing engine, or talking to MongoDB. 

## Expected Outcomes
- Completely decoupled from Express HTTP `req`/`res` objects.
- Functions solely take native Javascript data types (e.g., objects, arrays, numbers).
- Readily unit-testable.

## How to Check/Test
- Use Jest to write isolated tests for service functions. Provide mock inputs and assert correct return values or thrown errors.

## Proper Syntax
```javascript
/**
 * @param {Object} start {lat, lng}
 * @param {Object} end {lat, lng}
 * @returns {Promise<Array>} Polyline coordinates
 */
const fetchRouteFromEngine = async (start, end) => {
   // business logic
   return [];
};
module.exports = fetchRouteFromEngine;
```
