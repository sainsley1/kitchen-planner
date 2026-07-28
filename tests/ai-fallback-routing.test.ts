import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pool: null as unknown,
  responses: [] as Array<{ value: unknown; usage: Record<string, unknown> }>,
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/db/client", () => ({ getPool: () => state.pool }));
vi.mock("@/lib/config", () => ({
  appConfig: {
    aiConfigured: true,
    models: {
      economy: "gpt-5.4-mini",
      routine: "gpt-5.4",
      fallback: "gpt-5.6-terra",
      reconciliation: "gpt-5.4",
      planning: "gpt-5.6-sol",
    },
  },
}));
vi.mock("@/lib/ai/provider", () => ({
  runStructured: vi.fn(async (input: Record<string, unknown>) => {
    state.calls.push(input);
    const response = state.responses.shift();
    if (!response) throw new Error("No mocked AI response is available");
    return response;
  }),
}));

import { generateGroceryRecommendations, generateQuickUpdate } from "../lib/services/ai-workflows";

const householdId = "22222222-2222-4222-8222-222222222222";
const userId = "99999999-9999-4999-8999-999999999999";
const inventoryId = "66666666-6666-4666-8666-666666666666";
const shoppingId = "55555555-5555-4555-8555-555555555555";
const locationId = "44444444-4444-4444-8444-444444444444";
const actor = { householdId, userId, displayName: "Alex", role: "owner" as const };

function quickAction(inventoryEntryId = inventoryId) {
  return {
    id: "use-item",
    type: "inventory_quantity",
    label: "Use one item",
    explanation: "The user requested it",
    inventoryEntryId,
    quantityMode: "subtract",
    quantity: 1,
    ingredient: null,
    brandVariety: null,
    category: null,
    unit: null,
    storageLocationId: null,
    storageDetail: null,
    packageState: null,
    priority: null,
    notes: null,
    addToShopping: null,
    shoppingItemId: null,
    shoppingStatus: null,
  };
}

function response(value: unknown, model = "gpt-5.4") {
  return {
    value,
    usage: {
      responseId: `resp-${state.responses.length}`,
      model,
      reasoningEffort: model === "gpt-5.4" ? "low" : "medium",
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 40,
      totalTokens: 140,
      estimatedCostUsd: 0.0008,
      latencyMs: 10,
    },
  };
}

function normalization(
  normalizedEnglish = "Use one orange soda",
  detectedLanguage = "English",
  wasTranslated = false,
) {
  return response({ detectedLanguage, wasTranslated, normalizedEnglish });
}

async function createDatabase() {
  const database = new PGlite();
  for (const migration of [
    "drizzle/0000_initial.sql",
    "drizzle/0001_phase3_persistence.sql",
    "drizzle/0002_phase4_cutover.sql",
    "drizzle/0003_meal_and_shopping_workflows.sql",
    "drizzle/0004_settings_and_shopping_cleanup.sql",
    "drizzle/0005_ai_foundation.sql",
    "drizzle/0006_model_fallback.sql",
    "drizzle/0007_economy_model_tier.sql",
  ])
    await database.exec(await fs.readFile(migration, "utf8"));
  const client = {
    query: (text: string, values?: unknown[]) => database.query(text, values),
    release: () => undefined,
  };
  state.pool = {
    connect: async () => client,
    query: (text: string, values?: unknown[]) => database.query(text, values),
  };
  await database.query("INSERT INTO households (id,name) VALUES ($1,'Kitchen')", [householdId]);
  await database.query(
    "INSERT INTO household_users (id,household_id,display_name,role) VALUES ($1,$2,'Alex','owner')",
    [userId, householdId],
  );
  await database.query(
    "INSERT INTO inventory_entries (id,household_id,ingredient,category,quantity,unit,package_state,priority) VALUES ($1,$2,'Orange soda','Beverages',2,'bottle','full','normal')",
    [inventoryId, householdId],
  );
  return database;
}

describe("explicit advanced-model fallback routing", () => {
  beforeEach(() => {
    state.pool = null;
    state.responses = [];
    state.calls = [];
  });

  it("offers an advanced retry for primary warnings and links an explicit retry to the original job", async () => {
    const database = await createDatabase();
    state.responses.push(
      normalization(),
      response({
        title: "Possible update",
        summary: "Review this update",
        warnings: ["The package size is unclear."],
        actions: [quickAction()],
      }),
      response(
        {
          title: "Resolved update",
          summary: "The advanced model resolved it",
          warnings: [],
          actions: [quickAction()],
        },
        "gpt-5.6-terra",
      ),
    );

    const primary = await generateQuickUpdate(actor, { text: "Use one orange soda" });
    expect(primary.proposal).not.toBeNull();
    expect(primary.fallback?.sourceJobId).toBeTruthy();
    expect(state.calls[0].schemaName).toBe("kitchen_english_normalization");
    expect(state.calls[0].modelTier).toBe("economy");
    expect(state.calls[1].modelTier).toBe("economy");

    const fallback = await generateQuickUpdate(actor, {
      fallbackOfJobId: primary.fallback!.sourceJobId,
    });
    expect(fallback.proposal).not.toBeNull();
    expect(fallback.fallback).toBeNull();
    expect(state.calls[2].modelTier).toBe("fallback");

    const jobs = await database.query<{ id: string; retryOf: string | null; inputText: string }>(
      `SELECT id,retry_of_job_id AS "retryOf",input_text AS "inputText" FROM ai_jobs ORDER BY created_at,id`,
    );
    const original = jobs.rows.find((job) => job.id === primary.fallback!.sourceJobId)!;
    const retry = jobs.rows.find((job) => job.retryOf === original.id)!;
    expect(retry.inputText).toBe(original.inputText);
    const runs = await database.query<{ tier: string; model: string; effort: string }>(
      `SELECT model_tier AS tier,model,reasoning_effort AS effort FROM ai_runs ORDER BY created_at,id`,
    );
    expect(runs.rows).toEqual([
      { tier: "economy", model: "gpt-5.4-mini", effort: "low" },
      { tier: "economy", model: "gpt-5.4-mini", effort: "low" },
      { tier: "fallback", model: "gpt-5.6-terra", effort: "medium" },
    ]);
    await database.close();
  }, 30_000);

  it("offers fallback after household validation fails and does not save an unsafe proposal", async () => {
    const database = await createDatabase();
    state.responses.push(
      normalization(),
      response({
        title: "Bad update",
        summary: "Contains an unknown ID",
        warnings: [],
        actions: [quickAction("77777777-7777-4777-8777-777777777777")],
      }),
    );
    const result = await generateQuickUpdate(actor, { text: "Use one orange soda" });
    expect(result.proposal).toBeNull();
    expect(result.fallback?.reason).toContain("failed household validation");
    expect(
      (await database.query<{ count: number }>("SELECT count(*)::int AS count FROM ai_proposals"))
        .rows[0].count,
    ).toBe(0);
    const runs = await database.query<{ status: string; tokens: number }>(
      "SELECT status,total_tokens AS tokens FROM ai_runs ORDER BY created_at,id",
    );
    expect(runs.rows).toEqual([
      { status: "completed", tokens: 140 },
      { status: "failed", tokens: 140 },
    ]);
    await database.close();
  }, 30_000);

  it("refuses escalation when the primary result did not request it", async () => {
    const database = await createDatabase();
    state.responses.push(
      normalization(),
      response({
        title: "Clear update",
        summary: "No ambiguity",
        warnings: [],
        actions: [quickAction()],
      }),
    );
    const result = await generateQuickUpdate(actor, { text: "Use one orange soda" });
    expect(result.fallback).toBeNull();
    const job = (
      await database.query<{ id: string }>(
        "SELECT id FROM ai_jobs WHERE input_snapshot->>'stage' IS NULL",
      )
    ).rows[0];
    await expect(generateQuickUpdate(actor, { fallbackOfJobId: job.id })).rejects.toThrow(
      "not eligible",
    );
    expect(state.calls).toHaveLength(2);
    await database.close();
  }, 30_000);

  it("normalizes Spanish before matching and proposal generation, then returns English", async () => {
    const database = await createDatabase();
    const spanish = "Morgan bebió un refresco";
    state.responses.push(
      normalization("Morgan drank one soda", "Spanish", true),
      response({
        title: "Inventory update",
        summary: "Morgan drank one soda.",
        warnings: [],
        actions: [quickAction()],
      }),
    );
    const result = await generateQuickUpdate(actor, { text: spanish });
    expect(result.proposal.payload.title).toBe("Inventory update");
    expect(String(state.calls[0].input)).toContain(spanish);
    expect(String(state.calls[1].input)).toContain("Morgan drank one soda");
    expect(String(state.calls[1].input)).not.toContain(spanish);
    const jobs = await database.query<{ inputText: string; snapshot: Record<string, unknown> }>(
      `SELECT input_text AS "inputText",input_snapshot AS snapshot FROM ai_jobs ORDER BY created_at,id`,
    );
    expect(jobs.rows[0].inputText).toBe(spanish);
    expect(jobs.rows[1].inputText).toBe("Morgan drank one soda");
    expect(jobs.rows[1].snapshot).toMatchObject({
      originalInputText: spanish,
      detectedLanguage: "Spanish",
      wasTranslated: true,
    });
    await database.close();
  }, 30_000);

  it("keeps complex multi-change updates on the primary model", async () => {
    const database = await createDatabase();
    const complex =
      "Remove spinach, Italian sausage, gai lan, basil, crushed tomatoes, and move black bean paste into the middle shelf; then reconcile the remaining quantities.";
    state.responses.push(
      normalization(complex),
      response({
        title: "Multi-item review",
        summary: "Review the requested household changes.",
        warnings: [],
        actions: [quickAction()],
      }),
    );
    await generateQuickUpdate(actor, { text: complex });
    expect(state.calls[0].modelTier).toBe("economy");
    expect(state.calls[1].modelTier).toBe("primary");
    const runs = await database.query<{ tier: string; model: string }>(
      `SELECT model_tier AS tier,model FROM ai_runs ORDER BY created_at,id`,
    );
    expect(runs.rows).toEqual([
      { tier: "economy", model: "gpt-5.4-mini" },
      { tier: "primary", model: "gpt-5.4" },
    ]);
    await database.close();
  }, 30_000);

  it("supplies a purchased item's linked archived inventory entry as a valid restock target", async () => {
    const database = await createDatabase();
    await database.query(
      "INSERT INTO storage_locations (id,household_id,name,detail) VALUES ($1,$2,'Fridge','Bottom shelf')",
      [locationId, householdId],
    );
    await database.query(
      "UPDATE inventory_entries SET storage_location_id=$1,storage_detail='Bottom shelf',archived_at=now() WHERE id=$2",
      [locationId, inventoryId],
    );
    await database.query(
      "INSERT INTO shopping_items (id,household_id,item,category,quantity,unit,status,inventory_entry_id) VALUES ($1,$2,'Orange soda','Beverages',1,'bottle','purchased',$3)",
      [shoppingId, householdId, inventoryId],
    );
    state.responses.push(
      response(
        {
          suggestions: [
            {
              shoppingItemId: shoppingId,
              category: "Beverages",
              quantity: 1,
              unit: "bottle",
              storageLocationId: locationId,
              storageDetail: "Bottom shelf",
              packageState: "sealed",
              priority: "normal",
              inventoryEntryId: inventoryId,
              notes: null,
              explanation:
                "Restore and restock the household's linked orange soda inventory entry.",
            },
          ],
          warnings: [],
        },
        "gpt-5.4-mini",
      ),
    );

    const result = await generateGroceryRecommendations(actor, { shoppingItemIds: [shoppingId] });
    expect(result.recommendation?.suggestions[0]).toMatchObject({
      shoppingItemId: shoppingId,
      inventoryEntryId: inventoryId,
      storageLocationId: locationId,
    });
    expect(result.fallback).toBeNull();
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].modelTier).toBe("economy");
    expect(String(state.calls[0].input)).toContain(inventoryId);
    expect(String(state.calls[0].input)).toContain('"archived":true');
    const run = await database.query<{ status: string; tier: string }>(
      "SELECT status,model_tier AS tier FROM ai_runs",
    );
    expect(run.rows).toEqual([{ status: "completed", tier: "economy" }]);
    await database.close();
  }, 30_000);
});
