ALTER TABLE flyer_sale_items
  ADD COLUMN category text,
  ADD COLUMN regular_price numeric(12,2),
  ADD COLUMN savings_amount numeric(12,2),
  ADD COLUMN discount_percent numeric(6,2),
  ADD COLUMN prioritized boolean NOT NULL DEFAULT false;

ALTER TABLE flyer_sale_items
  ADD CONSTRAINT flyer_sale_regular_price_check
    CHECK (regular_price IS NULL OR regular_price >= price),
  ADD CONSTRAINT flyer_sale_savings_amount_check
    CHECK (savings_amount IS NULL OR (savings_amount >= 0 AND (regular_price IS NULL OR savings_amount <= regular_price))),
  ADD CONSTRAINT flyer_sale_discount_percent_check
    CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100));

CREATE INDEX flyer_sale_items_planning_priority_idx
  ON flyer_sale_items (household_id,prioritized DESC,status,item);

ALTER TABLE meal_plan_entries
  ADD COLUMN weekly_plan_meal_id text,
  ADD COLUMN planned_inventory_uses jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE meal_plan_entries AS entry
   SET weekly_plan_meal_id=(
         SELECT meal->>'id'
           FROM weekly_plans AS plan
           CROSS JOIN LATERAL jsonb_array_elements(plan.current_payload->'meals') AS meal
          WHERE plan.id=entry.weekly_plan_id
            AND meal->>'mealDate'=entry.meal_date::text
            AND meal->>'mealType'=entry.meal_type::text
            AND meal->>'dish'=entry.dish
            AND (
              (entry.assigned_user_id IS NULL AND meal->>'assignedUserId' IS NULL)
              OR entry.assigned_user_id::text=meal->>'assignedUserId'
            )
          LIMIT 1
       ),
       planned_inventory_uses=COALESCE((
         SELECT meal->'inventoryUses'
           FROM weekly_plans AS plan
           CROSS JOIN LATERAL jsonb_array_elements(plan.current_payload->'meals') AS meal
          WHERE plan.id=entry.weekly_plan_id
            AND meal->>'mealDate'=entry.meal_date::text
            AND meal->>'mealType'=entry.meal_type::text
            AND meal->>'dish'=entry.dish
            AND (
              (entry.assigned_user_id IS NULL AND meal->>'assignedUserId' IS NULL)
              OR entry.assigned_user_id::text=meal->>'assignedUserId'
            )
          LIMIT 1
       ),'[]'::jsonb)
 WHERE entry.weekly_plan_id IS NOT NULL
   AND entry.weekly_plan_meal_id IS NULL;

CREATE TABLE meal_day_inventory_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  meal_date date NOT NULL,
  suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applied','dismissed')),
  created_by uuid REFERENCES household_users(id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES household_users(id) ON DELETE SET NULL,
  resolution jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX meal_day_inventory_reviews_pending_uq
  ON meal_day_inventory_reviews (household_id,meal_date)
  WHERE status='pending';

CREATE INDEX meal_day_inventory_reviews_household_status_idx
  ON meal_day_inventory_reviews (household_id,status,meal_date);

WITH retired AS (
  UPDATE weekly_plans AS plan
     SET archived_at=now(),updated_at=now()
   WHERE plan.status='committed'
     AND plan.archived_at IS NULL
     AND EXISTS (
       SELECT 1 FROM meal_plan_entries AS entry
        WHERE entry.weekly_plan_id=plan.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM meal_plan_entries AS entry
        WHERE entry.weekly_plan_id=plan.id
          AND entry.archived_at IS NULL
     )
  RETURNING plan.id,plan.household_id
)
INSERT INTO audit_events (
  household_id,actor_user_id,source,action,entity_type,entity_id,reason,after_state
)
SELECT household_id,NULL,'system','archive','weekly_plan',id,
       'Archived automatically because every committed meal-plan day is resolved',
       jsonb_build_object('status','committed','archivedAutomatically',true)
  FROM retired;
