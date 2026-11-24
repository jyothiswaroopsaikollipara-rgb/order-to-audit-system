BEGIN;

ALTER TABLE customers
ADD COLUMN IF NOT EXISTS gstin TEXT,
ADD COLUMN IF NOT EXISTS address TEXT;

ALTER TABLE items
ADD COLUMN IF NOT EXISTS hsn_code TEXT;

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS billing_snapshot JSONB;

UPDATE customers
SET address = CASE
    WHEN state_code = '33' THEN 'Tamil Nadu, India'
    WHEN state_code = '29' THEN 'Karnataka, India'
    ELSE 'India'
END
WHERE address IS NULL;

UPDATE items
SET hsn_code = '210690'
WHERE sku = 'MURUKKU200'
  AND hsn_code IS NULL;

COMMIT;