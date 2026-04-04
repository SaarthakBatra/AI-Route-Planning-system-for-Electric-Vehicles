/**
 * @file context.js
 * @module backend/utils/context
 * @description Manages asynchronous request context using AsyncLocalStorage.
 */
const { AsyncLocalStorage } = require('async_hooks');

/**
 * Shared storage for the current request's session metadata.
 * Stores:
 *  - logTimestamp: Unix Epoch MS
 *  - logDir: The constructed folder name for the current request.
 *  - backendBuffer: []
 *  - cacheBuffer: []
 *  - databaseBuffer: []
 */
const storage = new AsyncLocalStorage();

/**
 * Global registry for active requests to allow emergency flushes.
 */
const activeRegistry = new Set();

const registerContext = (ctx) => {
    activeRegistry.add(ctx);
};

const unregisterContext = (ctx) => {
    activeRegistry.delete(ctx);
};

module.exports = { storage, activeRegistry, registerContext, unregisterContext };
