import "server-only";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { HouseholdSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { getPool } from "@/lib/db/client";
import {
  recipeImportDraftSchema,
  recipeImportRequestSchema,
  recipeInputSchema,
} from "@/lib/ai/contracts";
import { runStructured, type AiModelTier, type AiUsage } from "@/lib/ai/provider";
import { attachmentInput, type AiAttachment } from "@/lib/ai/attachments";

const RECIPE_IMPORT_PROMPT = `Extract one recipe faithfully from the supplied household text, public source URL, image or PDF. Return all user-facing text in English while preserving proper dish and ingredient names. Do not invent missing quantities, cooking times, yields, ratings or instructions. Use null or an extraction warning when the source does not establish a value. Ingredient preparation belongs in preparation, not the ingredient name. Instructions must remain in source order. A public URL must be the exact supplied recipe URL, never a guessed alternate URL. Classify practical freezer, leftover and packed-lunch suitability conservatively. Identify key flavor assets (sauces, marinades, spices, aromatics, herbs, or pastes) and include them in tags with a "flavor_asset:" prefix (e.g. "flavor_asset:garlic", "flavor_asset:ginger", "flavor_asset:chili").`;
const scheduleSchema = z.object({
  weekStart: z.string().date(),
  itemType: z.enum(["breakfast", "lunch", "dinner", "snack", "dessert", "prep"]),
  assignedUserId: z.string().uuid().nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null),
});

function pool() {
  const value = getPool();
  if (!value) throw new Error("Database is not configured");
  return value;
}
async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function audit(
  client: PoolClient,
  actor: HouseholdSession,
  action: string,
  id: string,
  before: unknown,
  after: unknown,
  reason: string,
) {
  await client.query(
    `INSERT INTO audit_events (household_id,actor_user_id,source,action,entity_type,entity_id,reason,before_state,after_state) VALUES ($1,$2,'ui',$3,'recipe',$4,$5,$6::jsonb,$7::jsonb)`,
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
function values(input: unknown) {
  const value = recipeInputSchema.parse(input);
  return {
    ...value,
    tags: [...new Set(value.tags.map((tag) => tag.trim()).filter(Boolean))],
    mealTypes: [...new Set(value.mealTypes)],
  };
}

export async function createRecipe(actor: HouseholdSession, input: unknown) {
  const value = values(input);
  return transaction(async (client) => {
    const result = await client.query(
      `INSERT INTO recipes (household_id,title,source_url,planned_yield,tags,notes,source_type,description,cuisine,meal_types,servings,prep_minutes,cook_minutes,ingredients,instructions,favorite,recipe_status,freezer_friendly,leftover_friendly,packed_lunch_friendly,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20,$21) RETURNING id`,
      [
        actor.householdId,
        value.title,
        value.sourceUrl,
        value.plannedYield,
        value.tags,
        value.notes,
        value.sourceType,
        value.description,
        value.cuisine,
        value.mealTypes,
        value.servings,
        value.prepMinutes,
        value.cookMinutes,
        JSON.stringify(value.ingredients),
        JSON.stringify(value.instructions),
        value.favorite,
        value.recipeStatus,
        value.freezerFriendly,
        value.leftoverFriendly,
        value.packedLunchFriendly,
        actor.userId,
      ],
    );
    await audit(
      client,
      actor,
      "create",
      result.rows[0].id,
      null,
      value,
      `Created household recipe: ${value.title}`,
    );
    return result.rows[0];
  });
}
export async function updateRecipe(actor: HouseholdSession, id: string, input: unknown) {
  const value = values(input);
  return transaction(async (client) => {
    const before = await client.query(
      `SELECT * FROM recipes WHERE id=$1 AND household_id=$2 AND archived_at IS NULL FOR UPDATE`,
      [id, actor.householdId],
    );
    if (!before.rows[0]) throw new Error("Recipe not found");
    await client.query(
      `UPDATE recipes SET title=$3,source_url=$4,planned_yield=$5,tags=$6,notes=$7,source_type=$8,description=$9,cuisine=$10,meal_types=$11,servings=$12,prep_minutes=$13,cook_minutes=$14,ingredients=$15::jsonb,instructions=$16::jsonb,favorite=$17,recipe_status=$18,freezer_friendly=$19,leftover_friendly=$20,packed_lunch_friendly=$21,updated_at=now() WHERE id=$1 AND household_id=$2`,
      [
        id,
        actor.householdId,
        value.title,
        value.sourceUrl,
        value.plannedYield,
        value.tags,
        value.notes,
        value.sourceType,
        value.description,
        value.cuisine,
        value.mealTypes,
        value.servings,
        value.prepMinutes,
        value.cookMinutes,
        JSON.stringify(value.ingredients),
        JSON.stringify(value.instructions),
        value.favorite,
        value.recipeStatus,
        value.freezerFriendly,
        value.leftoverFriendly,
        value.packedLunchFriendly,
      ],
    );
    await audit(
      client,
      actor,
      "update",
      id,
      before.rows[0],
      value,
      `Updated household recipe: ${value.title}`,
    );
    return { id };
  });
}
export async function archiveRecipe(actor: HouseholdSession, id: string) {
  return transaction(async (client) => {
    const before = await client.query(
      `SELECT * FROM recipes WHERE id=$1 AND household_id=$2 AND archived_at IS NULL FOR UPDATE`,
      [id, actor.householdId],
    );
    if (!before.rows[0]) throw new Error("Recipe not found");
    const result = await client.query(
      `UPDATE recipes SET archived_at=now(),updated_at=now() WHERE id=$1 AND household_id=$2 RETURNING id`,
      [id, actor.householdId],
    );
    await audit(
      client,
      actor,
      "archive",
      id,
      before.rows[0],
      result.rows[0],
      `Archived household recipe: ${before.rows[0].title}`,
    );
    return result.rows[0];
  });
}

function modelFor(tier: AiModelTier) {
  return tier === "economy" ? appConfig.models.economy : appConfig.models.routine;
}
async function beginImport(actor: HouseholdSession, tier: AiModelTier, snapshot: unknown) {
  return transaction(async (client) => {
    const job = await client.query<{ id: string }>(
      `INSERT INTO ai_jobs (household_id,actor_user_id,workflow,status,input_snapshot,started_at) VALUES ($1,$2,'recipe_import','running',$3::jsonb,now()) RETURNING id`,
      [actor.householdId, actor.userId, JSON.stringify(snapshot)],
    );
    const run = await client.query<{ id: string }>(
      `INSERT INTO ai_runs (job_id,model,reasoning_effort,prompt_version,status,model_tier) VALUES ($1,$2,'low','recipe-import-v1','running',$3) RETURNING id`,
      [job.rows[0].id, modelFor(tier), tier],
    );
    return { jobId: job.rows[0].id, runId: run.rows[0].id };
  });
}
async function finishImport(
  ids: { jobId: string; runId: string },
  usage: AiUsage,
  error?: unknown,
) {
  const message = error instanceof Error ? error.message.slice(0, 2000) : null;
  if (message) {
    await pool().query(
      `UPDATE ai_runs SET status='failed',error_message=$2,completed_at=now() WHERE id=$1`,
      [ids.runId, message],
    );
    await pool().query(
      `UPDATE ai_jobs SET status='failed',error_message=$2,completed_at=now() WHERE id=$1`,
      [ids.jobId, message],
    );
    return;
  }
  await transaction(async (client) => {
    await client.query(
      `UPDATE ai_runs SET response_id=$2,status='completed',input_tokens=$3,cached_input_tokens=$4,output_tokens=$5,total_tokens=$6,estimated_cost_usd=$7,latency_ms=$8,web_search_calls=$9,web_source_count=$10,completed_at=now() WHERE id=$1`,
      [
        ids.runId,
        usage.responseId,
        usage.inputTokens,
        usage.cachedInputTokens,
        usage.outputTokens,
        usage.totalTokens,
        usage.estimatedCostUsd,
        usage.latencyMs,
        usage.webSearchCalls,
        usage.webSourceCount,
      ],
    );
    await client.query(`UPDATE ai_jobs SET status='completed',completed_at=now() WHERE id=$1`, [
      ids.jobId,
    ]);
  });
}
export async function importRecipeDraft(
  actor: HouseholdSession,
  inputValue: unknown,
  attachment?: AiAttachment,
) {
  if (!appConfig.aiConfigured) throw new Error("OpenAI is not configured");
  const supplied = inputValue && typeof inputValue === "object" ? inputValue : {};
  const input = recipeImportRequestSchema.parse({ ...supplied, fileProvided: Boolean(attachment) });
  const tier: AiModelTier =
    attachment || input.sourceUrl || Number(input.text?.length) > 6000 ? "primary" : "economy";
  const ids = await beginImport(actor, tier, {
    sourceUrl: input.sourceUrl,
    hasText: Boolean(input.text),
    filename: attachment?.filename ?? null,
  });
  const requestText = JSON.stringify({
    sourceUrl: input.sourceUrl,
    recipeText: input.text,
    sourceType: attachment ? "imported_file" : input.sourceUrl ? "external_link" : "imported_text",
  });
  try {
    const result = await runStructured({
      householdId: actor.householdId,
      schema: recipeImportDraftSchema,
      schemaName: "kitchen_recipe_import",
      instructions: RECIPE_IMPORT_PROMPT,
      input: attachment ? attachmentInput(requestText, attachment) : requestText,
      modelTier: tier,
      maxOutputTokens: 12_000,
      webSearch: Boolean(input.sourceUrl),
    });
    const parsedDraft = recipeImportDraftSchema.parse(result.value);
    const draft = {
      ...parsedDraft,
      ingredients: parsedDraft.ingredients.map((ing) => ({
        ...ing,
        quantity:
          ing.quantity != null ? Math.round((ing.quantity + Number.EPSILON) * 1000) / 1000 : null,
      })),
    };
    await finishImport(ids, result.usage);
    return {
      draft,
      modelTier: tier,
      usage: {
        totalTokens: result.usage.totalTokens,
        estimatedCostUsd: result.usage.estimatedCostUsd,
      },
    };
  } catch (error) {
    await finishImport(
      ids,
      {
        responseId: "",
        model: "",
        reasoningEffort: "low",
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: 0,
        webSearchCalls: 0,
        webSourceCount: 0,
      },
      error,
    );
    throw error;
  }
}

export async function addRecipeToUnscheduled(
  actor: HouseholdSession,
  id: string,
  inputValue: unknown,
) {
  const input = scheduleSchema.parse(inputValue);
  return transaction(async (client) => {
    const recipe = await client.query<{ id: string; title: string; plannedYield: string | null }>(
      `SELECT id,title,planned_yield AS "plannedYield" FROM recipes WHERE id=$1 AND household_id=$2 AND archived_at IS NULL`,
      [id, actor.householdId],
    );
    if (!recipe.rows[0]) throw new Error("Recipe not found");
    if (input.assignedUserId) {
      const user = await client.query(
        `SELECT 1 FROM household_users WHERE id=$1 AND household_id=$2 AND active=true`,
        [input.assignedUserId, actor.householdId],
      );
      if (!user.rows[0]) throw new Error("Household member not found");
    }
    const created = await client.query<{ id: string }>(
      `INSERT INTO unscheduled_items (household_id,week_start,item_type,assigned_user_id,title,recipe_id,planned_yield,status,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,'planned',$8) RETURNING id`,
      [
        actor.householdId,
        input.weekStart,
        input.itemType,
        input.assignedUserId,
        recipe.rows[0].title,
        id,
        recipe.rows[0].plannedYield,
        input.notes,
      ],
    );
    await client.query(
      `INSERT INTO audit_events (household_id,actor_user_id,source,action,entity_type,entity_id,reason,after_state) VALUES ($1,$2,'ui','create','unscheduled_item',$3,$4,$5::jsonb)`,
      [
        actor.householdId,
        actor.userId,
        created.rows[0].id,
        `Added saved recipe ${recipe.rows[0].title} to Unscheduled items`,
        JSON.stringify({ recipeId: id, ...input }),
      ],
    );
    return created.rows[0];
  });
}
