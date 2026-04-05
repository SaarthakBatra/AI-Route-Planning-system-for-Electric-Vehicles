/**
 * @file uid.js
 * @module backend/utils/uid
 * @description Persistent Request ID (UID) generator using directory-based atomicity.
 * Manages an incremental integer UID stored as a filename in the Output/ directory.
 * 
 * @workflow
 * 1. Initialize the Output/ directory.
 * 2. Scan for 'counter.{N}.txt' filename to find the current state.
 * 3. Use fs.renameSync to atomically increment the counter.
 * 4. Return the unique integer N for indexing and session logging.
 */
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', '..', '..', 'Output');

/**
 * Manages an incremental integer UID stored as a filename in the Output/ directory.
 * Pattern: counter.<UID>.txt
 * 
 * @returns {number} The current UID.
 */
const getAndIncrementUID = () => {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const files = fs.readdirSync(OUTPUT_DIR);
    const counterFile = files.find(f => f.startsWith('counter.') && f.endsWith('.txt'));

    if (!counterFile) {
        // First request: UID 1, prep next file counter.2.txt
        fs.writeFileSync(path.join(OUTPUT_DIR, 'counter.2.txt'), '');
        return 1;
    }

    // Extract N from counter.N.txt
    const n = parseInt(counterFile.split('.')[1]);
    const currentUID = isNaN(n) ? 1 : n;

    // Rename to increment the state
    const oldPath = path.join(OUTPUT_DIR, counterFile);
    const newPath = path.join(OUTPUT_DIR, `counter.${currentUID + 1}.txt`);
    
    try {
        fs.renameSync(oldPath, newPath);
    } catch (e) {
        // Fallback if rename fails (e.g. race condition)
        console.error(`UID Rename Failed: ${e.message}`);
    }

    return currentUID;
};

module.exports = { getAndIncrementUID };
