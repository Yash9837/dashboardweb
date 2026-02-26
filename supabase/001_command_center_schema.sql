-- ============================================================================
-- COMMAND CENTER DATABASE SCHEMA
-- SmartCommerce — Event-driven Financial Ledger Architecture
-- ============================================================================
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- ============================================================================

-- 1. SKU MASTER TABLE
CREATE TABLE IF NOT EXISTS skus (
  sku TEXT PRIMARY KEY,
  asin TEXT,
  title TEXT,
  category TEXT,
  brand TEXT,
  cost_per_unit NUMERIC(12,2) DEFAULT 0,
  packaging_cost NUMERIC(12,2) DEFAULT 0,
  shipping_cost_internal NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ORDERS TABLE (operational metadata — NOT financial truth)
CREATE TABLE IF NOT EXISTS orders (
  amazon_order_id TEXT PRIMARY KEY,
  account_id TEXT,
  purchase_date TIMESTAMPTZ,
  shipment_date TIMESTAMPTZ,
  delivery_date TIMESTAMPTZ,
  order_status TEXT,
  currency TEXT DEFAULT 'INR',
  fulfillment_channel TEXT,
  is_prime BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ORDER ITEMS
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amazon_order_id TEXT REFERENCES orders(amazon_order_id),
  sku TEXT REFERENCES skus(sku),
  asin TEXT,
  title TEXT,
  quantity_ordered INT DEFAULT 1,
  item_price NUMERIC(12,2) DEFAULT 0,
  shipping_price NUMERIC(12,2) DEFAULT 0,
  tax_amount NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. FINANCIAL EVENTS LEDGER (★ SOURCE OF TRUTH ★)
CREATE TABLE IF NOT EXISTS financial_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT DEFAULT 'default',
  amazon_order_id TEXT,
  sku TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('shipment','refund','fee','adjustment','ad_spend')),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  quantity INT DEFAULT 0,
  currency TEXT DEFAULT 'INR',
  posted_date TIMESTAMPTZ NOT NULL,
  delivery_date TIMESTAMPTZ,
  fee_type TEXT,
  reference_id TEXT,
  raw_payload_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent upsert index (enterprise principle #3)
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_events_ref_type
  ON financial_events (reference_id, event_type)
  WHERE reference_id IS NOT NULL;

-- Performance index for revenue state queries
CREATE INDEX IF NOT EXISTS idx_fin_events_posted ON financial_events (posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_fin_events_sku ON financial_events (sku, posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_fin_events_type ON financial_events (event_type, posted_date DESC);

-- 5. INVENTORY SNAPSHOTS
CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT DEFAULT 'default',
  sku TEXT REFERENCES skus(sku),
  available_quantity INT DEFAULT 0,
  inbound_quantity INT DEFAULT 0,
  reserved_quantity INT DEFAULT 0,
  snapshot_date DATE NOT NULL,
  UNIQUE(sku, snapshot_date)
);

-- 6. ADVERTISING DATA
CREATE TABLE IF NOT EXISTS ad_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT DEFAULT 'default',
  date DATE NOT NULL,
  sku TEXT,
  campaign_id TEXT,
  ad_spend NUMERIC(12,2) DEFAULT 0,
  clicks INT DEFAULT 0,
  impressions INT DEFAULT 0,
  attributed_sales NUMERIC(12,2) DEFAULT 0,
  orders INT DEFAULT 0,
  UNIQUE(sku, date, campaign_id)
);

-- 7. TRAFFIC DATA
CREATE TABLE IF NOT EXISTS traffic_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  sku TEXT,
  detail_page_views INT DEFAULT 0,
  sessions INT DEFAULT 0,
  buy_box_percentage NUMERIC(5,2) DEFAULT 0,
  UNIQUE(sku, date)
);

-- 8. SKU DAILY METRICS (pre-aggregated — dashboards read from here)
CREATE TABLE IF NOT EXISTS sku_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  sku TEXT NOT NULL,
  revenue_live NUMERIC(14,2) DEFAULT 0,
  revenue_locked NUMERIC(14,2) DEFAULT 0,
  units_sold_live INT DEFAULT 0,
  units_sold_locked INT DEFAULT 0,
  refund_amount NUMERIC(14,2) DEFAULT 0,
  refund_units INT DEFAULT 0,
  ad_spend NUMERIC(14,2) DEFAULT 0,
  net_contribution NUMERIC(14,2) DEFAULT 0,
  margin_percent NUMERIC(6,2) DEFAULT 0,
  tacos NUMERIC(6,2) DEFAULT 0,
  return_rate NUMERIC(6,2) DEFAULT 0,
  UNIQUE(sku, date)
);

-- 9. ACCOUNT DAILY METRICS (pre-aggregated — header KPIs read from here)
CREATE TABLE IF NOT EXISTS account_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  total_revenue_live NUMERIC(14,2) DEFAULT 0,
  total_revenue_locked NUMERIC(14,2) DEFAULT 0,
  net_contribution_live NUMERIC(14,2) DEFAULT 0,
  net_contribution_locked NUMERIC(14,2) DEFAULT 0,
  total_units_live INT DEFAULT 0,
  total_units_locked INT DEFAULT 0,
  total_refund_amount NUMERIC(14,2) DEFAULT 0,
  total_fees NUMERIC(14,2) DEFAULT 0,
  total_ad_spend NUMERIC(14,2) DEFAULT 0,
  acos NUMERIC(6,2) DEFAULT 0,
  total_profit NUMERIC(14,2) DEFAULT 0,
  return_rate NUMERIC(6,2) DEFAULT 0
);

-- 10. INVENTORY HEALTH (computed)
CREATE TABLE IF NOT EXISTS inventory_health (
  sku TEXT PRIMARY KEY REFERENCES skus(sku),
  available_units INT DEFAULT 0,
  avg_daily_sales_7d NUMERIC(8,2) DEFAULT 0,
  days_inventory NUMERIC(8,1) DEFAULT 0,
  risk_status TEXT CHECK (risk_status IN ('red','yellow','green')),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- 11. ALERTS
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT,
  alert_type TEXT NOT NULL,
  alert_status TEXT DEFAULT 'active' CHECK (alert_status IN ('active','acknowledged','resolved')),
  severity TEXT DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  title TEXT,
  message TEXT,
  trigger_value NUMERIC(14,2),
  threshold_value NUMERIC(14,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts (alert_status, created_at DESC);

-- 12. SYNC METADATA (for incremental sync tracking)
CREATE TABLE IF NOT EXISTS sync_metadata (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Enable Row Level Security (recommended for Supabase)
-- For now, allow all access via anon key (tighten in production)
-- ============================================================================
ALTER TABLE skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE traffic_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE sku_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_metadata ENABLE ROW LEVEL SECURITY;

-- Permissive policies (anon access for development)
-- DROP existing policies first to make migration idempotent
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN VALUES ('skus'),('orders'),('order_items'),('financial_events'),
    ('inventory_snapshots'),('ad_metrics'),('traffic_metrics'),
    ('sku_daily_metrics'),('account_daily_metrics'),('inventory_health'),('alerts'),
    ('sync_metadata')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Allow all for anon" ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY "Allow all for anon" ON %I FOR ALL TO anon USING (true) WITH CHECK (true)',
      tbl
    );
  END LOOP;
END $$;
