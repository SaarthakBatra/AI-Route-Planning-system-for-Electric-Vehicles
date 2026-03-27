# Tests Specification

## Purpose
The `tests/backend/` directory strictly isolates tests from production logic. It groups both end-to-end integration tests (using Supertest) and isolated unit tests (using Jest mocks).

## Expected Outcomes
- Scripts should run successfully via `npm test` from the `modules/backend/` directory.

## Proper Syntax
```javascript
const request = require('supertest');
const app = require('../../modules/backend/index'); 

describe('POST /api/routes/calculate', () => {
    // tests
});
```
