'use strict';

// Run with: node migrateDb.js
// Adds missing columns/indexes for older database deployments.

const pool = require('./db');

async function hasColumn(tableName, columnName) {
    const [rows] = await pool.query(
        `SELECT 1
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?
         LIMIT 1`,
        [tableName, columnName]
    );
    return rows.length > 0;
}

async function getColumnMeta(tableName, columnName) {
        const [rows] = await pool.query(
                `SELECT DATA_TYPE, COLUMN_TYPE, EXTRA
                 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                     AND TABLE_NAME = ?
                     AND COLUMN_NAME = ?
                 LIMIT 1`,
                [tableName, columnName]
        );
        return rows[0] || null;
}

async function hasIndex(tableName, indexName) {
    const [rows] = await pool.query(
        `SELECT 1
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND INDEX_NAME = ?
         LIMIT 1`,
        [tableName, indexName]
    );
    return rows.length > 0;
}

(async () => {
    try {
        const alterStatements = [];

        if (!(await hasColumn('iap_service', 'balance_after'))) {
            alterStatements.push(
                "ALTER TABLE iap_service ADD COLUMN balance_after INT NOT NULL DEFAULT 0 AFTER balance_before"
            );
        }

        const idMeta = await getColumnMeta('iap_service', 'id');
        if (!idMeta) {
            alterStatements.push("ALTER TABLE iap_service ADD COLUMN id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST");
        } else {
            const isBigint = String(idMeta.DATA_TYPE).toLowerCase() === 'bigint';
            const hasAutoIncrement = String(idMeta.EXTRA || '').toLowerCase().includes('auto_increment');
            if (!isBigint || !hasAutoIncrement) {
                alterStatements.push("ALTER TABLE iap_service MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT");
            }
        }

        if (!(await hasColumn('iap_service', 'product_id'))) {
            alterStatements.push(
                "ALTER TABLE iap_service ADD COLUMN product_id VARCHAR(64) NULL AFTER balance_after"
            );
        }

        if (!(await hasColumn('iap_service', 'transaction_id'))) {
            alterStatements.push(
                "ALTER TABLE iap_service ADD COLUMN transaction_id VARCHAR(128) NULL AFTER product_id"
            );
        }

        if (!(await hasColumn('iap_service', 'platform'))) {
            alterStatements.push(
                "ALTER TABLE iap_service ADD COLUMN platform ENUM('IOS','ANDROID') NULL AFTER transaction_id"
            );
        }

        if (!(await hasColumn('iap_service', 'note'))) {
            alterStatements.push(
                "ALTER TABLE iap_service ADD COLUMN note VARCHAR(255) NULL AFTER platform"
            );
        }

        if (!(await hasColumn('iap_service', 'created_at'))) {
            alterStatements.push(
                "ALTER TABLE iap_service ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER note"
            );
        }

        if (!(await hasIndex('iap_service', 'idx_user'))) {
            alterStatements.push("ALTER TABLE iap_service ADD INDEX idx_user (user_id)");
        }

        if (!(await hasIndex('iap_service', 'idx_type'))) {
            alterStatements.push("ALTER TABLE iap_service ADD INDEX idx_type (transaction_type)");
        }

        if (!(await hasIndex('iap_service', 'transaction_id'))) {
            alterStatements.push("ALTER TABLE iap_service ADD UNIQUE INDEX transaction_id (transaction_id)");
        }

        if (alterStatements.length === 0) {
            console.log('No migration needed. Schema already up-to-date.');
        } else {
            for (const sql of alterStatements) {
                await pool.query(sql);
                console.log('OK:', sql);
            }
            console.log('Migration completed.');
        }
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
