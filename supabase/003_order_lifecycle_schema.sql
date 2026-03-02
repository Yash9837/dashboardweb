-- ============================================================================
-- ORDER LIFECYCLE & CLOSED ORDER DETECTION — Schema Extensions
-- Amazon SP-API Closed Orders Detection System (Industry Method)
-- ============================================================================
-- Adds financial lifecycle tracking to orders:
--   OPEN → DELIVERED_PENDING_SETTLEMENT → PENDING_RETURN_WINDOW → FINANCIALLY_CLOSED
-- ============================================================================

-- ── Extend orders table with financial lifecycle columns ──

DO $$
BEGIN
  -- Financial status: tracks the order lifecycle stage
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'financial_status'
  ) THEN
    ALTER TABLE orders ADD COLUMN financial_status TEXT DEFAULT 'OPEN'
      CHECK (financial_status IN ('OPEN', 'DELIVERED_PENDING_SETTLEMENT', 'PENDING_RETURN_WINDOW', 'FINANCIALLY_CLOSED'));
  END IF;

  -- Last financial event date for this order
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'last_event_date'
  ) THEN
    ALTER TABLE orders ADD COLUMN last_event_date TIMESTAMPTZ;
  END IF;

  -- Return window deadline (delivery_date + 30 days safe / 45 days extended)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'return_deadline'
  ) THEN
    ALTER TABLE orders ADD COLUMN return_deadline TIMESTAMPTZ;
  END IF;

  -- When the order was marked financially closed
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'financial_closed_at'
  ) THEN
    ALTER TABLE orders ADD COLUMN financial_closed_at TIMESTAMPTZ;
  END IF;

  -- Settlement ID that this order belongs to
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'settlement_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN settlement_id TEXT;
  END IF;

  -- Settlement status for this order's events
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'settlement_status'
  ) THEN
    ALTER TABLE orders ADD COLUMN settlement_status TEXT DEFAULT 'Unsettled'
      CHECK (settlement_status IN ('Unsettled', 'Open', 'Closed'));
  END IF;

  -- Total financial events count for this order
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'event_count'
  ) THEN
    ALTER TABLE orders ADD COLUMN event_count INT DEFAULT 0;
  END IF;

  -- Net settlement amount calculated from all financial events
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'net_settlement_amount'
  ) THEN
    ALTER TABLE orders ADD COLUMN net_settlement_amount NUMERIC(14,2) DEFAULT 0;
  END IF;
END
$$;

-- ── Indexes for lifecycle queries ──

CREATE INDEX IF NOT EXISTS idx_orders_financial_status
  ON orders (financial_status);

CREATE INDEX IF NOT EXISTS idx_orders_return_deadline
  ON orders (return_deadline)
  WHERE return_deadline IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_settlement
  ON orders (settlement_id)
  WHERE settlement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_delivery_date
  ON orders (delivery_date)
  WHERE delivery_date IS NOT NULL;

-- ── Create order_lifecycle_log table for audit trail ──

CREATE TABLE IF NOT EXISTS order_lifecycle_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amazon_order_id TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_log_order
  ON order_lifecycle_log (amazon_order_id, created_at DESC);

-- ── RLS for new table ──

ALTER TABLE order_lifecycle_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "anon_order_lifecycle_log" ON order_lifecycle_log;
  CREATE POLICY "anon_order_lifecycle_log" ON order_lifecycle_log
    FOR ALL USING (true) WITH CHECK (true);
END
$$;

-- ── Create closed_order_runs table to track automation runs ──

CREATE TABLE IF NOT EXISTS closed_order_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL CHECK (run_type IN ('manual', 'cron', 'sync')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  orders_processed INT DEFAULT 0,
  orders_closed INT DEFAULT 0,
  orders_promoted INT DEFAULT 0,
  errors TEXT[],
  duration_ms INT,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_closed_order_runs_date
  ON closed_order_runs (started_at DESC);

ALTER TABLE closed_order_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "anon_closed_order_runs" ON closed_order_runs;
  CREATE POLICY "anon_closed_order_runs" ON closed_order_runs
    FOR ALL USING (true) WITH CHECK (true);
END
$$;
