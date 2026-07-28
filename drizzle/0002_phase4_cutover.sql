CREATE TABLE unscheduled_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  item_type meal_type NOT NULL DEFAULT 'prep',
  assigned_user_id uuid REFERENCES household_users(id) ON DELETE SET NULL,
  title text NOT NULL,
  recipe_id uuid REFERENCES recipes(id) ON DELETE SET NULL,
  planned_yield text,
  status meal_status NOT NULL DEFAULT 'planned',
  notes text,
  legacy_source jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX unscheduled_household_week_idx
  ON unscheduled_items(household_id, week_start, status, item_type);

ALTER TABLE import_rows
  ADD COLUMN destination_type text,
  ADD COLUMN requires_reconciliation boolean NOT NULL DEFAULT false,
  ADD COLUMN suggested_action text,
  ADD COLUMN duplicate_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN resolution_action text,
  ADD COLUMN resolution_payload jsonb,
  ADD COLUMN resolution_target_id uuid,
  ADD COLUMN resolved_by uuid REFERENCES household_users(id) ON DELETE SET NULL,
  ADD COLUMN resolved_at timestamptz;

ALTER TABLE import_batches
  ADD COLUMN reconciliation_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN resolved_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN committed_by uuid REFERENCES household_users(id) ON DELETE SET NULL,
  ADD COLUMN committed_at timestamptz;

CREATE TABLE cutover_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES household_users(id) ON DELETE SET NULL,
  status text NOT NULL,
  backup_reference text NOT NULL,
  before_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX cutover_committed_batch_uq
  ON cutover_runs(batch_id) WHERE status = 'committed';

CREATE INDEX import_rows_reconciliation_idx
  ON import_rows(batch_id, requires_reconciliation, resolved_at);
