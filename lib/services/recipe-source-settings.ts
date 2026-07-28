import "server-only";
import type { HouseholdSession } from "@/lib/auth/session";
import { recipeSourcePreferencesSchema, type RecipeSourcePreferences } from "@/lib/ai/contracts";
import { getPool } from "@/lib/db/client";

const KEY = "recipe_source_preferences";
const defaults: RecipeSourcePreferences = {
  preferredDomains: [],
  blockedDomains: [],
  preferSavedRecipes: true,
  allowVideoSources: false,
  allowPaywalledSources: false,
  allowRegistrationSources: false,
};
function pool() {
  const value = getPool();
  if (!value) throw new Error("Database is not configured");
  return value;
}
function domain(value: string) {
  const trimmed = value.trim().toLocaleLowerCase();
  if (!trimmed) return "";
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return trimmed.replace(/^www\./, "").replace(/\/$/, "");
  }
}
function normalized(value: RecipeSourcePreferences): RecipeSourcePreferences {
  const preferred = [...new Set(value.preferredDomains.map(domain).filter(Boolean))];
  const blocked = [...new Set(value.blockedDomains.map(domain).filter(Boolean))];
  return {
    ...value,
    preferredDomains: preferred.filter((entry) => !blocked.includes(entry)),
    blockedDomains: blocked,
  };
}
export async function getRecipeSourcePreferences(householdId: string) {
  const result = await pool().query<{ value: unknown }>(
    `SELECT value FROM app_settings WHERE household_id=$1 AND key=$2`,
    [householdId, KEY],
  );
  return normalized(recipeSourcePreferencesSchema.parse(result.rows[0]?.value ?? defaults));
}
export async function setRecipeSourcePreferences(actor: HouseholdSession, input: unknown) {
  if (actor.role !== "owner")
    throw new Error("Only the household owner can change recipe-source settings");
  const next = normalized(recipeSourcePreferencesSchema.parse(input));
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const before = await client.query<{ value: unknown }>(
      `SELECT value FROM app_settings WHERE household_id=$1 AND key=$2 FOR UPDATE`,
      [actor.householdId, KEY],
    );
    await client.query(
      `INSERT INTO app_settings (household_id,key,value) VALUES ($1,$2,$3::jsonb) ON CONFLICT (household_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
      [actor.householdId, KEY, JSON.stringify(next)],
    );
    await client.query(
      `INSERT INTO audit_events (household_id,actor_user_id,source,action,entity_type,reason,before_state,after_state) VALUES ($1,$2,'ui','update','app_setting','Updated recipe-source preferences',$3::jsonb,$4::jsonb)`,
      [
        actor.householdId,
        actor.userId,
        JSON.stringify(before.rows[0]?.value ?? defaults),
        JSON.stringify(next),
      ],
    );
    await client.query("COMMIT");
    return next;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
