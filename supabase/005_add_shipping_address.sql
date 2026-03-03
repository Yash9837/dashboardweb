-- Migration 005: Add shipping address columns to orders table
-- Stores city & state from Amazon ShippingAddress for location display

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'ship_city'
  ) THEN
    ALTER TABLE orders ADD COLUMN ship_city TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'ship_state'
  ) THEN
    ALTER TABLE orders ADD COLUMN ship_state TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'ship_postal_code'
  ) THEN
    ALTER TABLE orders ADD COLUMN ship_postal_code TEXT;
  END IF;
END $$;
