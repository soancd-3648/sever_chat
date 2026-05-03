'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { verifyAppleReceipt, decodeJWSPayload } = require('./appleIap');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const DEFAULT_NEW_USER_POINTS = Number(process.env.DEFAULT_NEW_USER_POINTS || 100);
const POINTS_PER_REQUEST      = Number(process.env.POINTS_PER_REQUEST || 50);

// Catalog of valid IAP product ids -> point amount.
const PRODUCT_CATALOG = {
    points_1000: 1000,
    points_2000: 2000,
    points_5000: 5000,
};

// ----- Helpers --------------------------------------------------------------

async function getOrCreateUser(deviceId) {
    if (!deviceId || typeof deviceId !== 'string') {
        throw Object.assign(new Error('device_id is required'), { status: 400 });
    }

    const [rows] = await pool.query(
        'SELECT id, balance FROM users WHERE device_id = ? LIMIT 1',
        [deviceId]
    );

    if (rows.length > 0) {
        return rows[0];
    }

    const [insert] = await pool.query(
        'INSERT INTO users (device_id, balance) VALUES (?, ?)',
        [deviceId, DEFAULT_NEW_USER_POINTS]
    );
    return { id: insert.insertId, balance: DEFAULT_NEW_USER_POINTS };
}

/**
 * Atomically applies a balance change.
 * type: 'PURCHASE' | 'USAGE' | 'REFUND'
 * Returns the new balance.
 */
async function applyTransaction({ userId, amount, type, productId = null, transactionId = null, platform = 'IOS', note = null }) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query(
            'SELECT balance FROM users WHERE id = ? FOR UPDATE',
            [userId]
        );
        if (rows.length === 0) {
            throw Object.assign(new Error('user not found'), { status: 404 });
        }
        const balanceBefore = rows[0].balance;
        const balanceAfter  = balanceBefore + amount;

        if (balanceAfter < 0) {
            throw Object.assign(new Error('insufficient points'), { status: 402 });
        }

        await conn.query(
            'UPDATE users SET balance = ? WHERE id = ?',
            [balanceAfter, userId]
        );

        await conn.query(
            `INSERT INTO iap_service
                (user_id, amount, transaction_type, balance_before, balance_after,
                 product_id, transaction_id, platform, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, amount, type, balanceBefore, balanceAfter, productId, transactionId, platform, note]
        );

        await conn.commit();
        return balanceAfter;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

// ----- Routes ---------------------------------------------------------------

app.get('/', (_req, res) => {
    res.json({
        service: 'aiimagechat-iap-server',
        status: 'ok',
        endpoints: [
            'GET /health',
            'GET /ready',
            'POST /wallet',
            'POST /spend',
            'POST /iap/apple/verify',
            'GET /transactions?device_id=...'
        ]
    });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/ready', async (_req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ ok: true, db: 'up' });
    } catch (err) {
        res.status(503).json({ ok: false, db: 'down', error: err.message });
    }
});

// Get or create the wallet for a device.
//   POST /wallet  { device_id }
app.post('/wallet', async (req, res) => {
    try {
        const user = await getOrCreateUser(req.body.device_id);
        res.json({ user_id: user.id, balance: user.balance });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// Spend points for one chat request.
//   POST /spend  { device_id, note? }
app.post('/spend', async (req, res) => {
    try {
        const user = await getOrCreateUser(req.body.device_id);
        const newBalance = await applyTransaction({
            userId: user.id,
            amount: -POINTS_PER_REQUEST,
            type: 'USAGE',
            note: req.body.note || 'chat_request',
        });
        res.json({ balance: newBalance, spent: POINTS_PER_REQUEST });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// Verify an Apple IAP and credit points server-side.
//   POST /iap/apple/verify
//     { device_id, product_id, jws_transaction?, receipt_data? }
//
// `jws_transaction` is `Transaction.jwsRepresentation` from StoreKit 2.
// `receipt_data`    is the base64 app-receipt for legacy StoreKit 1.
app.post('/iap/apple/verify', async (req, res) => {
    try {
        const { device_id, product_id, jws_transaction, receipt_data, transaction_id: bodyTxId } = req.body || {};
        if (!product_id || !PRODUCT_CATALOG[product_id]) {
            return res.status(400).json({ error: 'unknown product_id' });
        }

        let resolvedProductId = null;
        let appleTxId         = null;

        if (jws_transaction) {
            // The client sends base64-encoded jsonRepresentation from StoreKit 2.
            // Try to decode it; if it fails, try JWS payload decode.
            try {
                const decoded = Buffer.from(jws_transaction, 'base64').toString('utf8');
                const payload = JSON.parse(decoded);
                resolvedProductId = payload.productId || product_id;
                appleTxId         = String(payload.transactionId || payload.originalTransactionId || bodyTxId || '');
            } catch {
                // If it's a JWS (3-segment JWT), decode the middle segment.
                try {
                    const payload = decodeJWSPayload(jws_transaction);
                    resolvedProductId = payload.productId;
                    appleTxId         = String(payload.transactionId || payload.originalTransactionId || bodyTxId || '');
                } catch {
                    return res.status(400).json({ error: 'invalid jws_transaction payload' });
                }
            }
        } else if (receipt_data) {
            const result = await verifyAppleReceipt(receipt_data);
            if (result.status !== 0) {
                return res.status(400).json({ error: 'apple receipt rejected', status: result.status });
            }
            const inApp = (result.receipt && result.receipt.in_app) || [];
            const match = inApp
                .filter(i => i.product_id === product_id)
                .sort((a, b) => Number(b.purchase_date_ms) - Number(a.purchase_date_ms))[0];
            if (!match) {
                return res.status(400).json({ error: 'product_id not found in receipt' });
            }
            resolvedProductId = match.product_id;
            appleTxId         = String(match.transaction_id);
        } else {
            return res.status(400).json({ error: 'jws_transaction or receipt_data required' });
        }

        if (resolvedProductId !== product_id) {
            return res.status(400).json({ error: 'product_id mismatch with receipt' });
        }
        if (!appleTxId) {
            return res.status(400).json({ error: 'missing transaction id' });
        }

        // Idempotency: reject if this Apple transaction id was already credited.
        const [dup] = await pool.query(
            'SELECT id FROM iap_service WHERE transaction_id = ? LIMIT 1',
            [appleTxId]
        );
        const user = await getOrCreateUser(device_id);
        if (dup.length > 0) {
            return res.json({ balance: user.balance, alreadyCredited: true });
        }

        const points = PRODUCT_CATALOG[product_id];
        const newBalance = await applyTransaction({
            userId: user.id,
            amount: points,
            type: 'PURCHASE',
            productId: product_id,
            transactionId: appleTxId,
            platform: 'IOS',
        });

        res.json({ balance: newBalance, credited: points, alreadyCredited: false });
    } catch (err) {
        console.error('verify error:', err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// Get recent transactions for a wallet (debugging / history UI).
//   GET /transactions?device_id=xxx
app.get('/transactions', async (req, res) => {
    try {
        const user = await getOrCreateUser(req.query.device_id);
        const [rows] = await pool.query(
            `SELECT id, amount, transaction_type, balance_before, balance_after,
                    product_id, transaction_id, platform, note, created_at
             FROM iap_service WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
            [user.id]
        );
        res.json({ balance: user.balance, transactions: rows });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
    console.log(`AIImageChat IAP server listening on :${port}`);
    console.log(`NODE_ENV=${process.env.NODE_ENV || 'development'}`);
});
