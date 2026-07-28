ALTER TABLE weekly_plans
  ADD COLUMN archived_at timestamptz;

CREATE INDEX weekly_plans_active_household_created_idx
  ON weekly_plans (household_id,created_at DESC)
  WHERE archived_at IS NULL;
