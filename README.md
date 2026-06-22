# saleor-quickbooks-app

A Saleor app that syncs orders to **QuickBooks Online** for InfinityBio Labs.

- **Paid order** (`ORDER_FULLY_PAID`) → QBO **SalesReceipt**
- **Refund** (`ORDER_REFUNDED`) → QBO **RefundReceipt**

Posted per-order against a single "Online Sales" customer with two generic income
items (Peptides / Supplies). Sales only — processor fees and payouts are reconciled
separately.

## Architecture

```
Saleor ──ORDER_FULLY_PAID / ORDER_REFUNDED──▶  this app (Vercel)  ──REST──▶  QuickBooks Online
                                                     │  OAuth2
                                                     ▼
                                               Upstash Redis  (rotating QBO tokens + id-map + idempotency)
```

The QuickBooks OAuth **refresh token rotates on every refresh**, so token state lives
in Upstash (not env). The Saleor install token uses `EnvAPL`. Redis keys are scoped
by `QBO_ENVIRONMENT` or optional `QBO_STORE_NAMESPACE`, and cached QBO refs are also
scoped by company realm.

## Local development

```bash
pnpm install
cp .env.example .env.local   # fill QBO_* + UPSTASH_* + QBO_ADMIN_SECRET
pnpm dev                     # http://localhost:3110
pnpm test                    # vitest unit tests (mappers, transaction selector)
pnpm typecheck && pnpm build
```

## Deploy (Vercel)

1. Import the repo into Vercel.
2. Set env vars from `.env.example` (`APL=env`, `SALEOR_APP_TOKEN`, `SALEOR_APP_ID`,
   `QBO_*`, `UPSTASH_REDIS_REST_*`, `QBO_ADMIN_SECRET`, `QBO_REDIRECT_URI` →
   `https://<deployment>/api/qbo/callback`).
3. Register the Intuit app's Redirect URI to match `QBO_REDIRECT_URI`.
4. Install in the Saleor Dashboard, then connect QuickBooks once via
   `/api/qbo/connect?secret=…`.
5. Pre-create/verify QBO refs via `/api/qbo/bootstrap?secret=…`.

## License

BSD-3-Clause.
