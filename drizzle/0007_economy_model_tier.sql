ALTER TABLE ai_runs DROP CONSTRAINT ai_runs_model_tier_check;

ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_model_tier_check CHECK (model_tier IN ('economy','primary','fallback'));
