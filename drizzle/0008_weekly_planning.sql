ALTER TYPE ai_workflow ADD VALUE IF NOT EXISTS 'weekly_planning';

ALTER TABLE ai_runs DROP CONSTRAINT ai_runs_model_tier_check;
ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_model_tier_check CHECK (model_tier IN ('economy','primary','fallback','planning'));

CREATE TABLE weekly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  job_id uuid NOT NULL UNIQUE REFERENCES ai_jobs(id) ON DELETE CASCADE,
  parent_plan_id uuid REFERENCES weekly_plans(id) ON DELETE SET NULL,
  created_by uuid REFERENCES household_users(id) ON DELETE SET NULL,
  committed_by uuid REFERENCES household_users(id) ON DELETE SET NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  start_meal meal_type NOT NULL DEFAULT 'breakfast',
  end_meal meal_type NOT NULL DEFAULT 'dinner',
  include_snacks boolean NOT NULL DEFAULT true,
  include_desserts boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','committed','rejected','superseded')),
  original_request text,
  normalized_request text,
  current_payload jsonb NOT NULL,
  validation_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision_number integer NOT NULL DEFAULT 1 CHECK (revision_number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  rejected_at timestamptz,
  CONSTRAINT weekly_plan_date_order CHECK (end_date >= start_date),
  CONSTRAINT weekly_plan_boundary_meals CHECK (start_meal IN ('breakfast','lunch','dinner') AND end_meal IN ('breakfast','lunch','dinner'))
);

CREATE INDEX weekly_plans_household_status_idx ON weekly_plans (household_id,status,created_at DESC);
CREATE INDEX weekly_plans_household_dates_idx ON weekly_plans (household_id,start_date,end_date);

CREATE TABLE weekly_plan_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  weekly_plan_id uuid NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  payload jsonb NOT NULL,
  validation_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL CHECK (source IN ('ai','ui','restore')),
  created_by uuid REFERENCES household_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_plan_revision_uq UNIQUE (weekly_plan_id,revision_number)
);

CREATE INDEX weekly_plan_revisions_plan_idx ON weekly_plan_revisions (weekly_plan_id,revision_number DESC);

ALTER TABLE meal_plan_entries ADD COLUMN weekly_plan_id uuid REFERENCES weekly_plans(id) ON DELETE SET NULL;
ALTER TABLE shopping_items ADD COLUMN weekly_plan_id uuid REFERENCES weekly_plans(id) ON DELETE SET NULL;

CREATE INDEX meal_plan_weekly_plan_idx ON meal_plan_entries (weekly_plan_id);
CREATE INDEX shopping_weekly_plan_idx ON shopping_items (weekly_plan_id);
