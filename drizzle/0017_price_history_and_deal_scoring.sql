CREATE TABLE IF NOT EXISTS flyer_item_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  flyer_source_id uuid NOT NULL REFERENCES flyer_sources(id) ON DELETE CASCADE,
  flyer_sale_item_id uuid NOT NULL REFERENCES flyer_sale_items(id) ON DELETE CASCADE,
  item text NOT NULL,
  normalized_ingredient text NOT NULL,
  store_name text NOT NULL,
  store_location text,
  sale_price numeric(10,2) NOT NULL,
  regular_price numeric(10,2),
  unit_price numeric(10,2),
  unit_measure text,
  valid_from date NOT NULL,
  valid_until date NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_lookup
  ON flyer_item_price_history (household_id, lower(normalized_ingredient), lower(store_name), valid_from DESC);

ALTER TABLE flyer_sale_items
  ADD COLUMN IF NOT EXISTS normalized_unit_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS normalized_unit_measure text,
  ADD COLUMN IF NOT EXISTS estimated_regular_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS deal_grade text;
