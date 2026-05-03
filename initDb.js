'use strict';

// Run with:  node initDb.js
// Creates the required tables on the configured MySQL database.

const fs = require('fs');
const path = require('path');
const pool = require('./db');

(async () => {
    try {
        const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        const statements = sql
            .split(/;\s*$/m)
            .map(s => s.trim())
            .filter(Boolean);

        for (const stmt of statements) {
            await pool.query(stmt);
            console.log('OK:', stmt.split('\n')[0].slice(0, 80));
        }
        console.log('\nDatabase initialised.');
    } catch (err) {
        console.error('Init failed:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
