-- Migration 063: Transfers Module
-- Creates the transfers table to track money transfers natively and link them to shipments.

CREATE TABLE IF NOT EXISTS transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    shipment_id UUID REFERENCES shipments(id) ON DELETE SET NULL,
    
    sender_name VARCHAR(255) NOT NULL,
    receiver_name VARCHAR(255) NOT NULL,
    
    amount NUMERIC(14, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    main_amount NUMERIC(14, 2) NOT NULL DEFAULT 0, -- Amount converted to USD
    
    commission NUMERIC(14, 2) NOT NULL DEFAULT 0,
    commission_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    commission_main NUMERIC(14, 2) NOT NULL DEFAULT 0, -- Commission converted to USD
    
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, COMPLETED, CANCELLED
    transfer_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfers_company_id ON transfers(company_id);
CREATE INDEX IF NOT EXISTS idx_transfers_shipment_id ON transfers(shipment_id);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_date ON transfers(transfer_date);

-- Add permissions for Transfers
INSERT INTO permissions (code, name, module, action)
VALUES 
  ('transfers.read', 'عرض الحوالات', 'transfers', 'read'),
  ('transfers.write', 'إضافة/تعديل الحوالات', 'transfers', 'write'),
  ('transfers.delete', 'حذف الحوالات', 'transfers', 'manage')
ON CONFLICT (code) DO NOTHING;
