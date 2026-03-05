-- ============================================================================
-- Migration 006: Finalized Order Overrides
-- Manual override system for orders blocking the "Payments Finalized Till" date
-- ============================================================================
-- Allows users to manually:
--   ✅ INCLUDE — Force-include a blocking order in finalized revenue
--   ❌ EXCLUDE — Permanently exclude (e.g., disputed/fraudulent)
--   ⏸  DEFER  — Temporarily skip (re-check later)
--   🔄 RESET  — Remove override, let system decide
-- ============================================================================

CREATE TABLE IF NOT EXISTS finalized_order_overrides (
  amazon_order_id TEXT PRIMARY KEY,
  override_action TEXT NOT NULL CHECK (override_action IN ('INCLUDE', 'EXCLUDE', 'DEFER')),
  reason TEXT,                          -- User's note for why they overrode
  overridden_by TEXT DEFAULT 'user',    -- Who made the decision
  overridden_at TIMESTAMPTZ DEFAULT NOW(),
  original_status TEXT,                 -- What the financial_status was before override
  original_blocker_reason TEXT,         -- Why the system flagged it as blocking
  metadata JSONB                        -- Extra context (events count, amounts, etc.)
);

CREATE INDEX IF NOT EXISTS idx_overrides_action ON finalized_order_overrides (override_action);

-- ── RLS ──
ALTER TABLE finalized_order_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "anon_finalized_order_overrides" ON finalized_order_overrides;
  CREATE POLICY "anon_finalized_order_overrides" ON finalized_order_overrides
    FOR ALL USING (true) WITH CHECK (true);
END
$$;
