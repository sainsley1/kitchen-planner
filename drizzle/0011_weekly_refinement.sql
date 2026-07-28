ALTER TYPE ai_job_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE ai_jobs
  ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false;

ALTER TABLE weekly_plan_revisions
  DROP CONSTRAINT weekly_plan_revisions_source_check;

ALTER TABLE weekly_plan_revisions
  ADD CONSTRAINT weekly_plan_revisions_source_check
  CHECK (source IN ('ai','ui','restore','refinement','alternative','recipe_link'));

ALTER TABLE weekly_plan_revisions
  ADD COLUMN summary text NOT NULL DEFAULT 'Plan revision',
  ADD COLUMN change_detail jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE weekly_plan_revisions
   SET summary=CASE source
     WHEN 'ai' THEN 'Initial AI plan'
     WHEN 'ui' THEN 'Manual plan edit'
     WHEN 'restore' THEN 'Restored an earlier revision'
     ELSE 'Plan revision'
   END;

CREATE TABLE weekly_plan_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  weekly_plan_id uuid NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('alternatives','recipe_link')),
  target_meal_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','dismissed','expired')),
  created_by uuid REFERENCES household_users(id) ON DELETE SET NULL,
  applied_by uuid REFERENCES household_users(id) ON DELETE SET NULL,
  selected_option_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX weekly_plan_suggestions_plan_idx
  ON weekly_plan_suggestions (weekly_plan_id,status,created_at DESC);
