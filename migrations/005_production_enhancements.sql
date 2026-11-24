BEGIN;

CREATE TABLE IF NOT EXISTS production_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    variance_tolerance_pct NUMERIC(5,2)
        NOT NULL DEFAULT 3
        CHECK (
            variance_tolerance_pct >= 0
            AND variance_tolerance_pct <= 100
        )
);

INSERT INTO production_settings (
    id, variance_tolerance_pct
)
VALUES (1, 3)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE production_runs
ADD COLUMN IF NOT EXISTS variance_tolerance_pct NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS selling_price_snapshot NUMERIC(14,2),
ADD COLUMN IF NOT EXISTS labour_cost NUMERIC(18,2),
ADD COLUMN IF NOT EXISTS energy_cost NUMERIC(18,2);

ALTER TABLE items
ADD COLUMN IF NOT EXISTS units_per_carton NUMERIC(18,4)
CHECK (units_per_carton > 0);

COMMIT;