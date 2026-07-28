ALTER TABLE ai_jobs
  ADD COLUMN retry_of_job_id uuid REFERENCES ai_jobs(id) ON DELETE SET NULL,
  ADD COLUMN fallback_reason text;

CREATE INDEX ai_jobs_retry_of_idx ON ai_jobs (retry_of_job_id);

ALTER TABLE ai_runs
  ADD COLUMN model_tier text NOT NULL DEFAULT 'primary',
  ADD COLUMN trigger_reason text;

ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_model_tier_check CHECK (model_tier IN ('primary','fallback'));

CREATE INDEX ai_runs_model_tier_created_idx ON ai_runs (model_tier, created_at DESC);
