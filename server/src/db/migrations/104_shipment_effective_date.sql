-- Add effective_date to shipments so ledger-originated shipments record
-- their real business date (ledger_date) rather than the insertion timestamp.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS effective_date date;

-- Backfill from daily_ledger_sessions.ledger_date for already-posted rows
UPDATE shipments s
SET effective_date = ls.ledger_date
FROM daily_ledger_rows dlr
JOIN daily_ledger_sessions ls ON ls.id = dlr.session_id
WHERE dlr.posted_shipment_id = s.id
  AND dlr.deleted_at IS NULL
  AND ls.deleted_at IS NULL
  AND s.effective_date IS NULL;

-- For shipments not linked to any ledger row, default to created_at::date
UPDATE shipments
SET effective_date = created_at::date
WHERE effective_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_effective_date
  ON shipments(effective_date)
  WHERE deleted_at IS NULL;

-- Also backfill posted_at on party_financial_movements to match the
-- shipment's effective_date for ledger-originated rows.
UPDATE party_financial_movements pfm
SET posted_at = s.effective_date::timestamptz
FROM shipments s
WHERE pfm.shipment_id = s.id
  AND s.effective_date IS NOT NULL
  AND pfm.posted_at::date != s.effective_date
  AND pfm.is_reversal = false;
