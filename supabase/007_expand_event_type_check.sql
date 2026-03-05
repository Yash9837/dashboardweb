-- Migration 007: Expand financial_events event_type CHECK constraint
-- Adds: 'refund_fee', 'tax_withheld', 'promotion' to allowed event types
-- Required for the sync pipeline fix that captures RefundCommission, TDS, and Promotions

-- Drop the old constraint
ALTER TABLE financial_events DROP CONSTRAINT IF EXISTS financial_events_event_type_check;

-- Re-create with all event types
ALTER TABLE financial_events ADD CONSTRAINT financial_events_event_type_check
  CHECK (event_type IN (
    'shipment',
    'fee',
    'refund',
    'adjustment',
    'ad_spend',
    'refund_fee',
    'tax_withheld',
    'promotion'
  ));
