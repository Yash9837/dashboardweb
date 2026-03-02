-- ============================================================================
-- REVENUE CALCULATOR — Extended Schema
-- Settlement Reconciliation & Enhanced Financial Tracking
-- ============================================================================

-- 13. SETTLEMENT PERIODS (Financial Event Groups → Settlement Payouts)
CREATE TABLE IF NOT EXISTS settlement_periods (
  settlement_id TEXT PRIMARY KEY,
  account_id TEXT DEFAULT 'default',
  financial_event_group_start TIMESTAMPTZ,
  financial_event_group_end TIMESTAMPTZ,
  fund_transfer_date TIMESTAMPTZ,
  original_total NUMERIC(14,2) DEFAULT 0,
  converted_total NUMERIC(14,2) DEFAULT 0,
  currency TEXT DEFAULT 'INR',
  processing_status TEXT DEFAULT 'Open' CHECK (processing_status IN ('Open','Closed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_fund_date ON settlement_periods (fund_transfer_date DESC);

-- 14. SETTLEMENT ITEMS (Individual line items within a settlement)
CREATE TABLE IF NOT EXISTS settlement_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id TEXT REFERENCES settlement_periods(settlement_id),
  amazon_order_id TEXT,
  sku TEXT,
  transaction_type TEXT NOT NULL,  -- 'Order', 'Refund', 'ServiceFee', 'Adjustment', 'Chargeback', etc.
  amount_type TEXT,                -- 'ItemPrice', 'ItemFees', 'Promotion', 'Other'
  amount_description TEXT,         -- 'Principal', 'Commission', 'FBAPerUnitFulfillmentFee', etc.
  amount NUMERIC(14,2) DEFAULT 0,
  quantity INT DEFAULT 0,
  posted_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_items_order ON settlement_items (amazon_order_id);
CREATE INDEX IF NOT EXISTS idx_settlement_items_settlement ON settlement_items (settlement_id);

-- 15. FINANCIAL EVENT GROUPS (maps events to settlement periods)
CREATE TABLE IF NOT EXISTS financial_event_groups (
  event_group_id TEXT PRIMARY KEY,
  account_id TEXT DEFAULT 'default',
  processing_status TEXT DEFAULT 'Open',
  fund_transfer_status TEXT DEFAULT 'Initiated',
  fund_transfer_date TIMESTAMPTZ,
  original_total NUMERIC(14,2) DEFAULT 0,
  beginning_balance NUMERIC(14,2) DEFAULT 0,
  trace_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Extend financial_events with event_group linkage (add column if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'financial_events' AND column_name = 'event_group_id'
  ) THEN
    ALTER TABLE financial_events ADD COLUMN event_group_id TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'financial_events' AND column_name = 'transaction_type'
  ) THEN
    ALTER TABLE financial_events ADD COLUMN transaction_type TEXT DEFAULT 'Order';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'financial_events' AND column_name = 'amount_description'
  ) THEN
    ALTER TABLE financial_events ADD COLUMN amount_description TEXT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_fin_events_group ON financial_events (event_group_id);
CREATE INDEX IF NOT EXISTS idx_fin_events_txn_type ON financial_events (transaction_type, posted_date DESC);

-- Enable RLS on new tables
ALTER TABLE settlement_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_event_groups ENABLE ROW LEVEL SECURITY;

-- Allow anon access (tighten in production)
DO $$
BEGIN
  DROP POLICY IF EXISTS "anon_settlement_periods" ON settlement_periods;
  CREATE POLICY "anon_settlement_periods" ON settlement_periods FOR ALL USING (true);

  DROP POLICY IF EXISTS "anon_settlement_items" ON settlement_items;
  CREATE POLICY "anon_settlement_items" ON settlement_items FOR ALL USING (true);

  DROP POLICY IF EXISTS "anon_financial_event_groups" ON financial_event_groups;
  CREATE POLICY "anon_financial_event_groups" ON financial_event_groups FOR ALL USING (true);
END
$$;
