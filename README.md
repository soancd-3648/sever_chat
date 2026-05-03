# AIImageChat IAP Server

Node.js + Express + MySQL backend that owns the points wallet for the
`AIImageChat` iOS app and validates Apple In-App Purchases server-side.

## Endpoints

| Method | Path                  | Body / Query                                         | Purpose                                |
| ------ | --------------------- | ---------------------------------------------------- | -------------------------------------- |
| POST   | `/wallet`             | `{ device_id }`                                      | Create-or-get the wallet (200 free pts) |
| POST   | `/spend`              | `{ device_id }`                                      | Charge 50 pts for one chat request      |
| POST   | `/iap/apple/verify`   | `{ device_id, product_id, jws_transaction }`         | Verify StoreKit 2 purchase, credit pts  |
| GET    | `/transactions`       | `?device_id=…`                                       | List recent ledger entries              |
| GET    | `/health`             | –                                                    | Health probe                            |

Valid product ids: `points_1000`, `points_2000`, `points_5000`.

## Setup

```bash
cd server
npm install
npm run init-db        # creates `users` and `iap_service` tables
npm start
```

DB credentials come from `.env`. The defaults already point at the free MySQL
host that ships in this repo. Override `APPLE_SHARED_SECRET` if you fall back
to legacy `verifyReceipt` validation.

## Database schema

See [schema.sql](schema.sql). Key columns of `iap_service`:

- `amount` — signed point delta (`+1000`, `-50`, …)
- `transaction_type` — `PURCHASE | USAGE | REFUND`
- `balance_before` / `balance_after` — for dispute reconciliation
- `transaction_id` — Apple transaction id, **unique** for idempotent crediting

## Workflow

1. App calls Apple StoreKit and obtains `Transaction.jwsRepresentation`.
2. App POSTs `{device_id, product_id, jws_transaction}` to `/iap/apple/verify`.
3. Server decodes the JWS, checks `productId`, ensures the
   `transactionId` is unseen, then credits points inside one DB transaction.
4. Server returns the new balance to the app.

## Deploy on Render (No custom domain needed)

Use Render's free subdomain (e.g. `https://sever-chat.onrender.com`) and set
`POINTS_API_BASE_URL` in the iOS app to that URL.

### Option A: Blueprint (recommended)

1. Keep `render.yaml` at project root.
2. In Render, create a new Blueprint service from this repository.
3. Confirm service uses `rootDir: server`, `buildCommand: npm install`,
    `startCommand: npm start`.
4. Set required env vars in Render dashboard:
    `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
5. Deploy.

### Option B: Manual web service

1. New Web Service in Render.
2. Root Directory: `server`
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Add same env vars as above.

### Post-deploy checks

```bash
curl -sS https://YOUR-SERVICE.onrender.com/health
curl -sS https://YOUR-SERVICE.onrender.com/ready
curl -sS -X POST https://YOUR-SERVICE.onrender.com/wallet \
   -H 'Content-Type: application/json' \
   -d '{"device_id":"render-smoke-test-1"}'
curl -sS -X POST https://YOUR-SERVICE.onrender.com/spend \
   -H 'Content-Type: application/json' \
   -d '{"device_id":"render-smoke-test-1"}'
```
