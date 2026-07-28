CREATE TYPE ai_workflow AS ENUM ('quick_update', 'feedback_learning', 'grocery_registration');
CREATE TYPE ai_job_status AS ENUM ('queued', 'running', 'completed', 'failed');
CREATE TYPE ai_proposal_status AS ENUM ('pending', 'approved', 'rejected', 'expired');

CREATE TABLE ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES household_users(id) ON DELETE SET NULL,
  workflow ai_workflow NOT NULL,
  status ai_job_status NOT NULL DEFAULT 'queued',
  input_text text,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX ai_jobs_household_created_idx ON ai_jobs (household_id, created_at DESC);

CREATE TABLE ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'openai',
  model text NOT NULL,
  reasoning_effort text NOT NULL,
  prompt_version text NOT NULL,
  response_id text,
  status text NOT NULL,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  estimated_cost_usd numeric(12,6),
  latency_ms integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX ai_runs_job_idx ON ai_runs (job_id, created_at DESC);

CREATE TABLE ai_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  job_id uuid NOT NULL UNIQUE REFERENCES ai_jobs(id) ON DELETE CASCADE,
  workflow ai_workflow NOT NULL,
  status ai_proposal_status NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL,
  selected_action_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_payload jsonb,
  approved_by uuid REFERENCES household_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_by uuid REFERENCES household_users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX ai_proposals_household_status_idx ON ai_proposals (household_id, status, created_at DESC);
