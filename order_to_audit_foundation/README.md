# Order-to-Audit: Foundation Package

This is **not a complete application**. It is the first engineering deliverable: a PostgreSQL schema proposal, traceability matrix, and an independently executable benchmark model with tests.

## Run the benchmark

```bash
cd order_to_audit_foundation
python3 -m unittest discover -s tests -v
python3 benchmark.py
```

## Schema

`schema.sql` targets PostgreSQL 16+. It is not yet wired to a backend and has not been database-integration-tested. Example: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql`.

## Business assumptions

- Weighted-average flour rate = (100 × ₹42 + 60 × ₹45) / 160 = ₹43.125/kg; 40 kg issued costs ₹1,725.
- Oil ₹140/L, spice ₹200/kg, pouches ₹2.50/piece and cartons ₹15/piece are held constant because the scenario supplies no purchases for these items.
- 188 good packets consume 188 pouches; 6 damaged pouches are additional consumption; total 194.
- 9 cartons are used as explicitly instructed, even though the BOM standard is 10. The prototype does not infer that cartons must equal ceiling(good packets / 20).
- 12 expected packets not produced are a yield shortfall, **not** assumed to equal 12 defective packets. The physical reason for that shortfall is unknown.
- Run cost includes actual materials/packaging consumed and ₹1,200 labour + ₹600 gas/power; overhead is assigned entirely to this single run. No scrap recovery value is assumed.
- Cost per good packet = (₹4,055 + ₹1,800) / 188 = ₹31.143617... → **₹31.14**. This is a benchmark model cost, not an accounting policy for all real factories.
- GST is 5% for the benchmark, split into 2.5% CGST + 2.5% SGST for Tamil Nadu to Tamil Nadu. Karnataka would be IGST at 5% if invoiced. Distributor B is **not** invoiced or dispatched because of shortage.
- Opening stock is represented in the future application as explicit OPENING ledger movements. The benchmark Python model initializes opening balances for simplicity.

## Risks and next steps

1. Implement a database-backed posting service with **atomic** stock movements and idempotency; current Python model is in-memory and not concurrency safe.
2. Introduce an `invoice_line` snapshot and credit-note tables before implementing invoice cancellation, as posted documents must preserve historical amounts.
3. Build real database migrations and seed data; `schema.sql` is a conceptual first version, not a finished migration history.
4. Model stock valuation entries and cost-of-goods-sold for finished goods to support financial reconciliation. A movement ledger alone is insufficient for full accounting.
5. Validate GSTIN, HSN, invoice numbering, place of supply, tax rounding, and applicable legal rules before describing the application as compliant outside this exercise.
6. Add all user interfaces, server endpoints, authorization, reports, exports, deployment, and browser tests. Nothing in this package is represented as implemented merely because a table exists.

## Submission constraints

The PDF requires a public repository with meaningful commit history, README, design note (max 2 pages), demo video (max 8 minutes), and hosted demo or single-command run. The source PDF has placeholder deadline dates; confirm the real deadline independently.
