ALTER TABLE shopping_items DROP COLUMN preferred_store;
ALTER TABLE shopping_items DROP COLUMN priority;

ALTER TABLE import_batches ADD COLUMN archived_at timestamptz;
CREATE INDEX import_batches_active_household_idx
  ON import_batches (household_id, created_at DESC)
  WHERE archived_at IS NULL;
