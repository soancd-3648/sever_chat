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
# sever_chat
