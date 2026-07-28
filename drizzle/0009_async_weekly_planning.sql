-- Only one queued or running full-week generation may exist per household.
-- Older active duplicates are failed before the partial unique index is added.
WITH ranked AS (
  SELECT id,row_number() OVER (PARTITION BY household_id ORDER BY created_at DESC,id DESC) AS position
    FROM ai_jobs
   WHERE workflow='weekly_planning' AND status IN ('queued','running')
     AND input_snapshot->>'jobKind'='weekly_plan_generation'
)
UPDATE ai_jobs
   SET status='failed',error_message='Superseded while enabling asynchronous weekly planning.',completed_at=now()
 WHERE id IN (SELECT id FROM ranked WHERE position>1);

CREATE UNIQUE INDEX ai_jobs_one_active_weekly_plan_per_household_idx
  ON ai_jobs (household_id)
  WHERE workflow='weekly_planning' AND status IN ('queued','running')
    AND input_snapshot->>'jobKind'='weekly_plan_generation';
