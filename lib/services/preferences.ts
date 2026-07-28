import "server-only";
import type { HouseholdSession } from "@/lib/auth/session";
import { foodPreferenceInputSchema } from "@/lib/ai/contracts";
import { getPool } from "@/lib/db/client";

function pool() {
  const value = getPool();
  if (!value) throw new Error("Database is not configured");
  return value;
}
async function validateUser(householdId: string, userId: string | null) {
  if (!userId) return;
  const result = await pool().query(
    `SELECT id FROM household_users WHERE id=$1 AND household_id=$2 AND active=true`,
    [userId, householdId],
  );
  if (!result.rows[0]) throw new Error("Household member not found");
}
async function audit(
  actor: HouseholdSession,
  action: string,
  id: string,
  before: unknown,
  after: unknown,
  reason: string,
) {
  await pool().query(
    `INSERT INTO audit_events (household_id,actor_user_id,source,action,entity_type,entity_id,reason,before_state,after_state) VALUES ($1,$2,'ui',$3,'food_preference',$4,$5,$6::jsonb,$7::jsonb)`,
    [
      actor.householdId,
      actor.userId,
      action,
      id,
      reason,
      JSON.stringify(before ?? null),
      JSON.stringify(after ?? null),
    ],
  );
}
export async function createFoodPreference(actor: HouseholdSession, input: unknown) {
  const value = foodPreferenceInputSchema.parse(input);
  await validateUser(actor.householdId, value.userId);
  const result = await pool().query(
    `INSERT INTO food_preferences (household_id,user_id,topic,classification,detail,context,status,effective_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      actor.householdId,
      value.userId,
      value.topic,
      value.classification,
      value.detail,
      value.context,
      value.status,
      value.effectiveDate,
    ],
  );
  await audit(
    actor,
    "create",
    result.rows[0].id,
    null,
    result.rows[0],
    `Created visible preference: ${value.topic}`,
  );
  return result.rows[0];
}
export async function updateFoodPreference(actor: HouseholdSession, id: string, input: unknown) {
  const value = foodPreferenceInputSchema.parse(input);
  await validateUser(actor.householdId, value.userId);
  const before = await pool().query(
    `SELECT * FROM food_preferences WHERE id=$1 AND household_id=$2`,
    [id, actor.householdId],
  );
  if (!before.rows[0]) throw new Error("Record not found");
  const result = await pool().query(
    `UPDATE food_preferences SET user_id=$3,topic=$4,classification=$5,detail=$6,context=$7,status=$8,effective_date=$9 WHERE id=$1 AND household_id=$2 RETURNING *`,
    [
      id,
      actor.householdId,
      value.userId,
      value.topic,
      value.classification,
      value.detail,
      value.context,
      value.status,
      value.effectiveDate,
    ],
  );
  await audit(
    actor,
    "update",
    id,
    before.rows[0],
    result.rows[0],
    `Updated visible preference: ${value.topic}`,
  );
  return result.rows[0];
}
export async function supersedeFoodPreference(actor: HouseholdSession, id: string) {
  const before = await pool().query(
    `SELECT * FROM food_preferences WHERE id=$1 AND household_id=$2`,
    [id, actor.householdId],
  );
  if (!before.rows[0]) throw new Error("Record not found");
  const result = await pool().query(
    `UPDATE food_preferences SET status='superseded' WHERE id=$1 AND household_id=$2 RETURNING *`,
    [id, actor.householdId],
  );
  await audit(
    actor,
    "supersede",
    id,
    before.rows[0],
    result.rows[0],
    `Superseded preference: ${before.rows[0].topic}`,
  );
  return result.rows[0];
}
