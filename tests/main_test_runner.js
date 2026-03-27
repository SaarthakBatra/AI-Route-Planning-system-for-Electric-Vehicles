/**
 * @fileoverview Central Test Runner for AI Route Planner
 * Configured to discover and run all tests across the project.
 *
 * Test Suites:
 *  Step 1 — Frontend unit tests
 *  Step 2 — Backend API & gRPC integration tests
 *  Step 2.5 — Routing Engine Python tests
 *  Step 3 — Cache (Redis) & Database (MongoDB) connection unit tests
 *  Step 4 — High-concurrency load tests (K6/Artillery, future)
 */

const { execSync } = require('child_process');
const path = require('path');

console.log("==========================================");
console.log("🚀 Initializing Central Test Runner...");
console.log("==========================================\n");

try {
  // ── Step 1: Frontend Unit Tests ──────────────────────────────────────────
  console.log("[*] Step 1: Discovering and Running Frontend Unit Tests...");
  console.log(" -> [Frontend]: Running tests/frontend.test.js");
  execSync(`node "${path.join(__dirname, 'frontend.test.js')}"`, { stdio: 'inherit' });

  // ── Step 2: Backend API & gRPC Tests ─────────────────────────────────────
  console.log("\n[*] Step 2: Running Backend API & gRPC Integration Tests...");
  console.log(" -> [Backend]: Running tests/backend/calculateRoute.test.js");
  execSync('npm test -- ../../tests/backend/calculateRoute.test.js', {
      cwd: path.join(__dirname, '../modules/backend'),
      stdio: 'inherit'
  });

  // ── Step 2.5: Routing Engine Python Tests ────────────────────────────────
  console.log("\n[*] Step 2.5: Running Routing Engine Python Tests...");
  const pytestPath = path.join(__dirname, '../modules/routing_engine/venv/bin/pytest');
  execSync(`"${pytestPath}"`, {
      cwd: path.join(__dirname, 'routing_engine'),
      stdio: 'inherit'
  });

  // ── Step 3a: Cache (Redis) Unit Tests ────────────────────────────────────
  console.log("\n[*] Step 3a: Running Cache (Redis) Unit Tests...");
  console.log(" -> [Cache]: Running tests/cache/redisConnection.test.js");
  execSync('npm test -- ../../tests/cache/redisConnection.test.js', {
      cwd: path.join(__dirname, '../modules/cache'),
      stdio: 'inherit'
  });

  // ── Step 3b: Database (MongoDB) Unit Tests ────────────────────────────────
  console.log("\n[*] Step 3b: Running Database (MongoDB) Unit Tests...");
  console.log(" -> [Database]: Running tests/database/mongoConnection.test.js");
  execSync('npm test -- ../../tests/database/mongoConnection.test.js', {
      cwd: path.join(__dirname, '../modules/database'),
      stdio: 'inherit'
  });

  // ── Step 4: High-Concurrency Load Tests (Future) ──────────────────────────
  console.log("\n[*] Step 4: High-Concurrency Load Tests (Pending — not yet implemented)");
  // TODO: Replace with K6/Artillery invocation when ready:
  // execSync('npm run test:load', { stdio: 'inherit' });

  console.log("\n✅ All test suites executed successfully.");
} catch (error) {
  console.error("\n❌ Test execution failed on a critical module.");
  console.error("Error details:", error.message);
  process.exit(1);
}
