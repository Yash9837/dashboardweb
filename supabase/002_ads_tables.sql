-- ============================================================================
-- ADVERTISING DATA TABLES
-- Migration 002: Amazon Ads API data storage
-- ============================================================================
-- Run in Supabase SQL Editor after 001_command_center_schema.sql
-- ============================================================================

-- 1. CAMPAIGN-LEVEL DAILY METRICS
-- One row per date × campaign — used for KPIs, daily trends, campaign table
CREATE TABLE IF NOT EXISTS ads_campaign_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,
  cost NUMERIC(12,2) DEFAULT 0,
  sales14d NUMERIC(12,2) DEFAULT 0,
  purchases14d INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_ads_campaign_daily_date ON ads_campaign_daily (date DESC);
CREATE INDEX IF NOT EXISTS idx_ads_campaign_daily_campaign ON ads_campaign_daily (campaign_id, date DESC);

-- 2. PRODUCT-LEVEL DAILY METRICS
-- One row per date × advertised SKU — used for per-SKU ads spend table
CREATE TABLE IF NOT EXISTS ads_product_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  campaign_name TEXT,
  advertised_sku TEXT,
  advertised_asin TEXT,
  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,
  cost NUMERIC(12,2) DEFAULT 0,
  sales14d NUMERIC(12,2) DEFAULT 0,
  purchases14d INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, advertised_sku, campaign_name)
);

CREATE INDEX IF NOT EXISTS idx_ads_product_daily_date ON ads_product_daily (date DESC);
CREATE INDEX IF NOT EXISTS idx_ads_product_daily_sku ON ads_product_daily (advertised_sku, date DESC);

-- 3. SYNC LOG — tracks which date ranges have been synced
CREATE TABLE IF NOT EXISTS ads_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL,       -- 'campaigns' or 'products'
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  rows_synced INT DEFAULT 0,
  status TEXT DEFAULT 'completed', -- 'completed', 'failed', 'in_progress'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ads_sync_log_type ON ads_sync_log (report_type, start_date);

-- 4. Enable RLS & permissive policies
ALTER TABLE ads_campaign_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_product_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_sync_log ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN VALUES ('ads_campaign_daily'),('ads_product_daily'),('ads_sync_log')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Allow all for anon" ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY "Allow all for anon" ON %I FOR ALL TO anon USING (true) WITH CHECK (true)',
      tbl
    );
  END LOOP;
END $$;


-- Drop the old constraint and create new one
-- Clear existing data to start fresh
-- Also clear failed sync logs for products

ALTER TABLE ads_product_daily DROP CONSTRAINT IF EXISTS ads_product_daily_date_advertised_sku_campaign_name_key;
TRUNCATE ads_product_daily;
ALTER TABLE ads_product_daily ADD CONSTRAINT ads_product_daily_date_sku_key UNIQUE (date, advertised_sku);
DELETE FROM ads_sync_log WHERE report_type = 'products';