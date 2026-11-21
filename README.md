# Order-to-Audit — Phase 2 Backend (working implementation, not final submission)

This phase adds a PostgreSQL-backed Express API for the benchmark's purchase → production → order → invoice → dispatch → payment loop. It is **backend-only**: there is no mobile interface, invoice PDF, monthly export, offline support, or deployment yet. This is **not** a complete or GST-certified accounting product.

## Requirements

Docker Desktop with Docker Compose, or Node.js 20+ and PostgreSQL 16+. The easiest setup is Docker Desktop.

## Start on Windows / macOS / Linux

1. Extract this ZIP and open `phase2_backend` in VS Code.
2. Copy `.env.example` to `.env` and replace all three placeholder values. Keep `.env` private.
3. Run `docker compose up --build` in the terminal. First boot creates the database and seeds benchmark masters. The API is at `http://localhost:3000`.
4. Check `http://localhost:3000/health` (returns `{"status":"ok"}`).
5. To reset the entire **local demo database**, run `docker compose down -v` and then `docker compose up --build` again. **This deletes all stored local data.**

Database initialization SQL runs only when the Postgres volume is first created. If changing the schema, use migrations or reset the disposable demo volume. Seed is idempotent on a populated database.

## Run unit tests

With Node.js installed, run `npm install` followed by `npm run check`. Tests check GST, interstate tax, yield/oil variance and weighted-average cost. These tests **do not** exercise a live database or HTTP integration. Docker/DB integration has not been executed in the delivery environment.

## Test credentials

Six seed users: `salesa@example.test`, `salesb@example.test`, `admin@example.test`, `production@example.test`, `auditor@example.test`, `owner@example.test`. All use the `DEMO_PASSWORD` you set in `.env`. POST `/auth/login` with `{"email":"admin@example.test","password":"YOUR_DEMO_PASSWORD"}`; copy the `token` from the response. For protected requests add `Authorization: Bearer YOUR_TOKEN`.

## Benchmark API sequence

1. `GET /masters` as admin or production; note item IDs and BOM ID (fresh seed normally item IDs 1–6, BOM ID 1).
2. `POST /purchases` as production: `{"reference":"FLOUR-PURCHASE-001","itemId":1,"quantity":"60","unitCost":"45"}`.
3. `POST /production-runs` as production, with a **fresh UUID** request key:

```json
{"requestKey":"11111111-1111-4111-8111-111111111111","bomId":1,"goodOutput":"188","issues":[{"itemId":1,"quantity":"40"},{"itemId":2,"quantity":"10.5"},{"itemId":3,"quantity":"1.2"},{"itemId":4,"quantity":"194","damagedQty":"6"},{"itemId":5,"quantity":"9"}],"labour":"1200","energy":"600"}
```

4. Login as `salesa@example.test`, then `POST /orders`: `{"requestKey":"22222222-2222-4222-8222-222222222222","customerId":1,"itemId":6,"quantity":"150"}`.
5. Login as admin: `POST /orders/1/approve`, `POST /orders/1/invoice`, `POST /invoices/1/dispatch` (all `{}` bodies).
6. Login as `salesb@example.test`; `POST /orders`: `{"requestKey":"33333333-3333-4333-8333-333333333333","customerId":2,"itemId":6,"quantity":"120"}`. Admin `POST /orders/2/approve` should return HTTP 409, shortage 32.
7. Admin `POST /invoices/1/payments`: `{"reference":"PAY-RETAILER-A-001","amount":"4000"}`.
8. Check `GET /stock`, `/stock/ledger`, `/reports/production`, `/reports/receivables` with an authorized token.

Expected balances: flour 120, oil 19.5, spice 3.8, pouches 306, cartons 21, finished goods 88; run cost ₹5,855 and cost/packet ₹31.14; invoice ₹7,875 and outstanding ₹3,875.

## Engineering design and known gaps

- Stock is the sum of append-only movement entries. Posting operations serialize using a database row lock on `inventory_mutex`; all stock deductions and associated documents occur in a single transaction. This coarse lock is simple and safe for a small factory but limits write throughput.
- Production material valuation uses **opening + purchases weighted-average rates**. This intentionally reproduces the benchmark, but **is not a full moving weighted-average cost ledger**: historical issue cost and later purchases are not tracked as perpetual inventory layers. Replace before real financial reporting.
- Production consumes 194 pouches (188 good + 6 damaged), and 9 cartons. Packaging variance is calculated against BOM standards.
- Price and GST rate are read from product master at invoicing time; immutable invoice line snapshots and legally compliant numbering/cancellation are not yet implemented. The FY26 invoice prefix is illustrative, not a real fiscal-year numbering engine.
- Auth is JWT-based with seeded demo users; rate limiting, refresh/revocation, security hardening and audited credentials are not implemented.
- Order approval checks available stock, and dispatch checks again, but **approval does not reserve stock**. Concurrent approved orders can exceed unreserved inventory; dispatch prevents negative stock and rejects insufficient quantities.
- Duplicate production and purchase submissions are idempotent by key/reference, but **the API does not reject conflicting payloads reused with the same key**. Fix before production deployment.
- `POST /orders` uses an upsert and does not mutate existing orders, but returns HTTP 201 on replay.
- There are no batch/expiry records, unit conversions, partial dispatches, returns, credit notes, PDF invoice, Excel/CSV exports, UI, or offline queue yet.
- Only dummy benchmark data is included. No real company/customer data should be loaded.

## Security note

Use this only as a **local development prototype**. Never expose the service to the public internet without security review, HTTPS, proper session management, rate limiting, validation improvements and business-rule coverage. Do not commit `.env`.

## Next phase

Implement database integration tests and invoice snapshots, then a mobile-friendly salesman UI and production/admin dashboards; add PDF invoices and report exports before final submission.
