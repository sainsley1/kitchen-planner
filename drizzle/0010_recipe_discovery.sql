ALTER TABLE weekly_plans
  ADD COLUMN discover_recipes boolean NOT NULL DEFAULT true;

ALTER TABLE ai_runs
  ADD COLUMN web_search_calls integer NOT NULL DEFAULT 0,
  ADD COLUMN web_source_count integer NOT NULL DEFAULT 0;

CREATE TABLE weekly_plan_recipe_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  weekly_plan_id uuid NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  source_title text,
  source_domain text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_plan_recipe_source_uq UNIQUE (weekly_plan_id,source_url)
);

CREATE INDEX weekly_plan_recipe_sources_plan_idx
  ON weekly_plan_recipe_sources (weekly_plan_id,verified_at DESC);
