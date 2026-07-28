ALTER TABLE meal_plan_entries
  ADD COLUMN archived_at timestamptz;

ALTER TABLE unscheduled_items
  ADD COLUMN source_meal_plan_entry_id uuid REFERENCES meal_plan_entries(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX unscheduled_source_meal_uq
  ON unscheduled_items(source_meal_plan_entry_id);

CREATE INDEX meal_plan_active_date_idx
  ON meal_plan_entries(household_id, meal_date)
  WHERE archived_at IS NULL;

-- Bring already-resolved days into the same lifecycle as new edits. A day is
-- complete when it has entries and none of them remain Planned.
WITH eligible_days AS (
  SELECT household_id, meal_date
    FROM meal_plan_entries
   WHERE archived_at IS NULL
   GROUP BY household_id, meal_date
  HAVING bool_and(status <> 'planned')
), created AS (
  INSERT INTO unscheduled_items (
    household_id, week_start, item_type, assigned_user_id, title, recipe_id,
    planned_yield, status, notes, source_meal_plan_entry_id
  )
  SELECT
    m.household_id,
    current_date - (((extract(dow FROM current_date))::integer + 1) % 7),
    m.meal_type,
    m.assigned_user_id,
    m.dish,
    m.recipe_id,
    m.planned_yield,
    'planned',
    concat_ws(E'\n', NULLIF(m.notes, ''), 'Deferred from archived meal plan (' || m.meal_date::text || ').'),
    m.id
  FROM meal_plan_entries m
  JOIN eligible_days d USING (household_id, meal_date)
  WHERE m.archived_at IS NULL AND m.status = 'deferred'
  ON CONFLICT (source_meal_plan_entry_id) DO NOTHING
  RETURNING *
)
INSERT INTO audit_events (
  household_id, source, action, entity_type, entity_id, reason, before_state, after_state
)
SELECT
  household_id,
  'system',
  'create',
  'unscheduled_item',
  id,
  'Returned a deferred meal from an archived day',
  NULL,
  to_jsonb(created)
FROM created;

WITH eligible_days AS (
  SELECT household_id, meal_date
    FROM meal_plan_entries
   WHERE archived_at IS NULL
   GROUP BY household_id, meal_date
  HAVING bool_and(status <> 'planned')
)
INSERT INTO audit_events (
  household_id, source, action, entity_type, entity_id, reason, before_state, after_state
)
SELECT
  m.household_id,
  'system',
  'archive',
  'meal_plan_entry',
  m.id,
  'Archived automatically because the day has no Planned entries',
  to_jsonb(m),
  jsonb_build_object('archivedAt', now())
FROM meal_plan_entries m
JOIN eligible_days d USING (household_id, meal_date)
WHERE m.archived_at IS NULL;

WITH eligible_days AS (
  SELECT household_id, meal_date
    FROM meal_plan_entries
   WHERE archived_at IS NULL
   GROUP BY household_id, meal_date
  HAVING bool_and(status <> 'planned')
)
UPDATE meal_plan_entries m
   SET archived_at = now(), updated_at = now()
  FROM eligible_days d
 WHERE m.household_id = d.household_id
   AND m.meal_date = d.meal_date
   AND m.archived_at IS NULL;
