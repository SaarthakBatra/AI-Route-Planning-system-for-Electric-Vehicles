# Utils Specification

## Purpose
The `utils/` directory houses shared boilerplate codebase functions, such as centralized logging formatters, custom error classes, or math helper functions.

## Expected Outcomes
- Pure functions without side effects where possible.
- Reusable across the entire backend module.

## Expected Files
- `logger.js`: Centralized logging with `DEBUG` configurable toggles.
- `requestLogger.js`: Express middleware intercepting `req`/`res` lifecycles automatically.
- `errorResponse.js`: Standardized HTTP error shell array templates.

## How to Check/Test
- Standard unit testing using Jest. Ensure 100% coverage on util functions since they are isolated.

## Proper Syntax
```javascript
const errorResponse = (res, code, message) => {
   return res.status(code).json({
      error: true,
      code,
      message
   });
};
module.exports = errorResponse;
```
