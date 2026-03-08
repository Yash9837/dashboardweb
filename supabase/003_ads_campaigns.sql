-- ============================================================================
-- ADVERTISING METADATA TABLES
-- Migration 003: Campaign Metadata Storage
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_campaigns (
  campaign_id TEXT PRIMARY KEY,
  name TEXT,
  state TEXT,
  targeting_type TEXT,
  budget NUMERIC(12,2) DEFAULT 0,
  budget_type TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ads_campaigns ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    EXECUTE 'DROP POLICY IF EXISTS "Allow all for anon" ON ads_campaigns';
    EXECUTE 'CREATE POLICY "Allow all for anon" ON ads_campaigns FOR ALL TO anon USING (true) WITH CHECK (true)';
END $$;
