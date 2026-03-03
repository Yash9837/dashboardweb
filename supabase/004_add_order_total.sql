-- Add order_total column to orders table (customer-facing selling price from Amazon OrderTotal.Amount)
-- This is the GROSS selling price before any fees — what the customer pays.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'order_total'
  ) THEN
    ALTER TABLE orders ADD COLUMN order_total NUMERIC(14,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'currency'
  ) THEN
    ALTER TABLE orders ADD COLUMN currency TEXT DEFAULT 'INR';
  END IF;
END
$$;
