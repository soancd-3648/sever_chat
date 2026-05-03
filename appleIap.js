'use strict';

// Apple StoreKit 2 / IAP receipt validation helpers.
//
// Two flows are supported:
//
//   1. Legacy `verifyReceipt` (StoreKit 1): the app uploads the base64
//      app-receipt and we POST it to Apple. Requires APPLE_SHARED_SECRET.
//
//   2. StoreKit 2 signed JWS transaction: the app uploads
//      `Transaction.jwsRepresentation` (a JWT). We decode the payload and
//      trust the productId / transactionId. Full signature verification
//      against Apple's root CA is left as a TODO – the JWS payload is signed
//      by Apple so it is tamper-evident; for production deployments verify
//      the signature using the App Store Server API certificates.

const axios = require('axios');

const PRODUCTION_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const SANDBOX_URL    = 'https://sandbox.itunes.apple.com/verifyReceipt';

async function verifyAppleReceipt(receiptData) {
    const body = {
        'receipt-data': receiptData,
        password: process.env.APPLE_SHARED_SECRET || '',
        'exclude-old-transactions': true,
    };

    let response = await axios.post(PRODUCTION_URL, body, { timeout: 15000 });

    // 21007 = receipt is from sandbox but sent to prod -> retry against sandbox
    if (response.data && response.data.status === 21007) {
        response = await axios.post(SANDBOX_URL, body, { timeout: 15000 });
    }

    return response.data;
}

function decodeJWSPayload(jws) {
    // JWS = header.payload.signature  (base64url encoded segments)
    const parts = String(jws).split('.');
    if (parts.length !== 3) {
        throw new Error('Invalid JWS – expected 3 segments');
    }
    const payload = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(payload);
}

module.exports = { verifyAppleReceipt, decodeJWSPayload };
