# Routes Specification

## Purpose
The `routes/` directory is strictly for expressing the URL endpoint routes and mapping those URLs to specific controller functions. **No business logic or request validation** should happen here.

## Expected Outcomes
- Each route file exports an Express router.
- Clean separation by functional domain (e.g. `routeApi.js`, `userApi.js`).
- The routes are registered in the main `index.js`.

## How to Check/Test
- Ensure `require('express').Router()` is successfully grouping routes.
- Integration test the endpoints to check 404s vs 200s.

## Proper Syntax
```javascript
const express = require('express');
const router = express.Router();
const controllerName = require('../controllers/controllerFile');

router.post('/endpoint', controllerName);

module.exports = router;
```
