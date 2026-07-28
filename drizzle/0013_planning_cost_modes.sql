ALTER TABLE ai_runs DROP CONSTRAINT IF EXISTS ai_runs_model_tier_check;
ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_model_tier_check
  CHECK (model_tier IN ('economy','primary','balanced','fallback','planning'));

-- Before 0.6.3.6 every full-week job was explicitly a Sol job. Preserve that
-- choice for queued, running and retryable historical jobs during upgrade.
UPDATE ai_jobs
   SET input_snapshot=jsonb_set(input_snapshot,'{request,planningMode}','"deep"'::jsonb,true)
 WHERE workflow='weekly_planning'
   AND input_snapshot->>'jobKind'='weekly_plan_generation'
   AND input_snapshot#>>'{request,planningMode}' IS NULL;
