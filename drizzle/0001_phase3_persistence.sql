CREATE TABLE app_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES household_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_session_user_idx ON app_sessions(user_id);
CREATE INDEX inventory_active_household_idx ON inventory_entries(household_id, archived_at, ingredient);
CREATE INDEX shopping_active_household_idx ON shopping_items(household_id, status, created_at);
CREATE INDEX feedback_household_date_idx ON meal_feedback(household_id, feedback_date DESC);
CREATE INDEX audit_household_date_idx ON audit_events(household_id, created_at DESC);
CREATE INDEX import_batch_household_date_idx ON import_batches(household_id, created_at DESC);
