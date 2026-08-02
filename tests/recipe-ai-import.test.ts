import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pool: null as unknown,
  responses: [] as Array<{ value: unknown; usage: unknown }>,
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
  runStructured: async () => {
    const next = state.responses.shift();
    if (!next) throw new Error("No mock response queued");
    return { value: next.value, usage: next.usage, sources: [] };
  },
}));

import { importRecipeDraft } from "../lib/services/recipes";

const householdId = "22222222-2222-4222-8222-222222222222";
const ownerId = "99999999-9999-4999-8999-999999999999";
const ownerActor = { householdId, userId: ownerId, displayName: "Alex", role: "owner" as const };

async function createDatabase() {
  const database = new PGlite();
  for (const name of [
    "0000_initial",
    "0001_phase3_persistence",
    "0002_phase4_cutover",
    "0003_meal_and_shopping_workflows",
    "0004_settings_and_shopping_cleanup",
    "0005_ai_foundation",
    "0006_model_fallback",
    "0007_economy_model_tier",
    "0008_weekly_planning",
    "0009_async_weekly_planning",
    "0010_recipe_discovery",
    "0011_weekly_refinement",
    "0012_recipe_library_and_flyers",
    "0013_planning_cost_modes",
    "0014_weekly_plan_archival",
    "0015_planning_opportunities_and_inventory_review",
    "0016_multibuy_flyer_price_integrity",
  ])
    await database.exec(await fs.readFile(`drizzle/${name}.sql`, "utf8"));

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
    [ownerId, householdId],
  );

  return database;
}

describe("AI recipe ingestion service", () => {
  beforeEach(() => {
    state.responses = [];
  });

  it("extracts recipe draft from text input with flavor asset tags", async () => {
    const db = await createDatabase();

    state.responses.push({
      value: {
        title: "Garlic Butter Chicken",
        sourceType: "imported_text",
        sourceUrl: null,
        description: "Pan-seared chicken breast in garlic butter sauce.",
        cuisine: "American",
        mealTypes: ["dinner"],
        plannedYield: "4 servings",
        servings: 4,
        prepMinutes: 10,
        cookMinutes: 20,
        ingredients: [
          {
            item: "Chicken Breast",
            category: "Meat",
            quantity: 500,
            unit: "g",
            preparation: null,
            optional: false,
            notes: null,
          },
          {
            item: "Garlic",
            category: "Produce",
            quantity: 4,
            unit: "cloves",
            preparation: "minced",
            optional: false,
            notes: null,
          },
          {
            item: "Butter",
            category: "Dairy",
            quantity: 2,
            unit: "tbsp",
            preparation: null,
            optional: false,
            notes: null,
          },
        ],
        instructions: [
          "Melt butter in skillet.",
          "Add minced garlic and cook chicken until golden.",
        ],
        tags: ["chicken", "quick", "flavor_asset:garlic", "flavor_asset:butter"],
        notes: "Serve with rice.",
        favorite: false,
        recipeStatus: "proven",
        freezerFriendly: true,
        leftoverFriendly: true,
        packedLunchFriendly: true,
        extractionWarnings: [],
      },
      usage: {
        responseId: "res-1",
        model: "gpt-5.4",
        reasoningEffort: "low",
        inputTokens: 400,
        cachedInputTokens: 0,
        outputTokens: 250,
        totalTokens: 650,
        estimatedCostUsd: 0.002,
        latencyMs: 50,
        webSearchCalls: 0,
        webSourceCount: 0,
      },
    });

    const result = await importRecipeDraft(ownerActor, {
      text: "Garlic Butter Chicken recipe...",
      sourceUrl: null,
    });

    expect(result.draft.title).toBe("Garlic Butter Chicken");
    expect(result.draft.tags).toContain("flavor_asset:garlic");
    expect(result.draft.ingredients.length).toBe(3);

    const jobs = await db.query<{ workflow: string }>(
      `SELECT workflow FROM ai_jobs WHERE household_id = $1`,
      [householdId],
    );
    expect(jobs.rows[0].workflow).toBe("recipe_import");

    await db.close();
  }, 40_000);

  it("extracts recipe draft from photo attachment", async () => {
    const db = await createDatabase();

    state.responses.push({
      value: {
        title: "Photo Recipe Tacos",
        sourceType: "imported_file",
        sourceUrl: null,
        description: "Tacos transcribed from photo.",
        cuisine: "Mexican",
        mealTypes: ["dinner"],
        plannedYield: "3 servings",
        servings: 3,
        prepMinutes: 15,
        cookMinutes: 10,
        ingredients: [
          {
            item: "Tortillas",
            category: "Bakery",
            quantity: 6,
            unit: "pcs",
            preparation: null,
            optional: false,
            notes: null,
          },
        ],
        instructions: ["Warm tortillas.", "Fill and serve."],
        tags: ["mexican", "flavor_asset:cilantro"],
        notes: null,
        favorite: false,
        recipeStatus: "proven",
        freezerFriendly: false,
        leftoverFriendly: true,
        packedLunchFriendly: false,
        extractionWarnings: [],
      },
      usage: {
        responseId: "res-2",
        model: "gpt-5.4",
        reasoningEffort: "low",
        inputTokens: 800,
        cachedInputTokens: 0,
        outputTokens: 200,
        totalTokens: 1000,
        estimatedCostUsd: 0.003,
        latencyMs: 50,
        webSearchCalls: 0,
        webSourceCount: 0,
      },
    });

    const attachment = {
      filename: "recipe_photo.jpeg",
      mimeType: "image/jpeg",
      bytes: Buffer.from("fake-jpeg-bytes"),
    };

    const result = await importRecipeDraft(ownerActor, { text: null, sourceUrl: null }, attachment);
    expect(result.draft.title).toBe("Photo Recipe Tacos");
    expect(result.draft.sourceType).toBe("imported_file");

    await db.close();
  }, 40_000);

  it("extracts recipe draft from video attachment", async () => {
    const db = await createDatabase();

    state.responses.push({
      value: {
        title: "Instagram Reel Sopes",
        sourceType: "imported_file",
        sourceUrl: null,
        description: "Sopes extracted from video reel.",
        cuisine: "Mexican",
        mealTypes: ["dinner"],
        plannedYield: "4 servings",
        servings: 4,
        prepMinutes: 20,
        cookMinutes: 15,
        ingredients: [
          {
            item: "Masa harina",
            category: "Baking & Cooking",
            quantity: 2,
            unit: "cups",
            preparation: null,
            optional: false,
            notes: null,
          },
        ],
        instructions: ["Mix dough.", "Pinch edges.", "Fry and serve."],
        tags: ["mexican", "sopes"],
        notes: null,
        favorite: false,
        recipeStatus: "proven",
        freezerFriendly: false,
        leftoverFriendly: true,
        packedLunchFriendly: false,
        extractionWarnings: [],
      },
      usage: {
        responseId: "res-3",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        inputTokens: 1200,
        cachedInputTokens: 0,
        outputTokens: 300,
        totalTokens: 1500,
        estimatedCostUsd: 0.005,
        latencyMs: 80,
        webSearchCalls: 0,
        webSourceCount: 0,
      },
    });

    const videoAttachment = {
      filename: "instagram_reel_sopes.mp4",
      mimeType: "video/mp4",
      bytes: Buffer.from("fake-mp4-bytes"),
    };

    const result = await importRecipeDraft(
      ownerActor,
      { text: null, sourceUrl: null },
      videoAttachment,
    );
    expect(result.draft.title).toBe("Instagram Reel Sopes");
    expect(result.draft.sourceType).toBe("imported_file");

    await db.close();
  }, 40_000);
});
