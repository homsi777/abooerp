-- Migration 064: Add commission_percentage to agents
-- This field stores the default commission rate for the agent (e.g., 5.00 for 5%)

ALTER TABLE agents 
ADD COLUMN IF NOT EXISTS commission_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN agents.commission_percentage IS 'Default commission percentage for the agent (0-100)';
