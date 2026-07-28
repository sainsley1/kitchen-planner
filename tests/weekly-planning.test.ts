import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  weeklyPlanMealSchema,
  weeklyPlanSchema,
  type WeeklyPlan,
  type WeeklyPlanRequest,
} from "../lib/ai/contracts";
import type { PlanningContext } from "../lib/ai/context";

const state = vi.hoisted(() => ({
  pool: null as unknown,
  responses: [] as Array<
    | {
        value: unknown;
        usage: Record<string, unknown>;
        sources: Array<{ url: string; title: string | null }>;
      }
    | Error
  >,
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
    planningReasoningEffort: "high",
    planningTimeoutMs: 1_800_000,
  },
}));
vi.mock("@/lib/ai/provider", () => ({
  runStructured: vi.fn(async (input: Record<string, unknown>) => {
    state.calls.push(input);
    const response = state.responses.shift();
    if (!response) throw new Error("No mocked AI response is available");
    if (response instanceof Error) throw response;
    return response;
  }),
  isAiTimeoutError: (error: unknown) =>
    error instanceof Error && error.name === "APIConnectionTimeoutError",
  aiUsageFromError: () => undefined,
}));

import {
  archiveWeeklyPlan,
  cancelWeeklyPlanJob,
  commitWeeklyPlan,
  dismissWeeklyPlanJob,
  materializeGeneratedWeeklyPlan,
  processWeeklyPlanJob,
  queueWeeklyPlan,
  restoreWeeklyPlanRevision,
  retryWeeklyPlanJob,
  reviseWeeklyPlan,
  validateWeeklyPlan,
} from "../lib/services/weekly-planning";
import {
  reconcileSameUnitShoppingShortfalls,
  reconcileWeeklyPlanShopping,
} from "../lib/services/weekly-shopping";
import { listWeeklyPlanJobs, listWeeklyPlans } from "../lib/db/queries";

const householdId = "22222222-2222-4222-8222-222222222222";
const ownerId = "99999999-9999-4999-8999-999999999999";
const memberId = "88888888-8888-4888-8888-888888888888";
const inventoryId = "66666666-6666-4666-8666-666666666666";
const saltId = "12121212-1212-4121-8121-121212121212";
const avocadoInventoryId = "13131313-1313-4131-8131-131313131313";
const yogurtInventoryId = "14141414-1414-4141-8141-141414141414";
const tahiniInventoryId = "15151515-1515-4151-8151-151515151515";
const pizzaId = "77777777-7777-4777-8777-777777777777";
const freezerId = "44444444-4444-4444-8444-444444444444";
const unscheduledId = "55555555-5555-4555-8555-555555555555";
const actor = { householdId, userId: ownerId, displayName: "Alex", role: "owner" as const };
const testDate = "2099-07-18";
const contextDate = "2099-07-15";

function usage(model: string, reasoningEffort: "low" | "medium" | "high") {
  return {
    responseId: `response-${state.calls.length}`,
    model,
    reasoningEffort,
    inputTokens: 500,
    cachedInputTokens: 100,
    outputTokens: 250,
    totalTokens: 750,
    estimatedCostUsd: model.includes("sol") ? 0.0095 : 0.0014,
    latencyMs: 25,
    webSearchCalls: model.includes("sol") ? 1 : 0,
    webSourceCount: model.includes("sol") ? 1 : 0,
  };
}

function meal(
  id: string,
  mealType: WeeklyPlan["meals"][number]["mealType"],
  dish: string,
  overrides: Partial<WeeklyPlan["meals"][number]> = {},
): WeeklyPlan["meals"][number] {
  return weeklyPlanMealSchema.parse({
    id,
    mealDate: testDate,
    mealType,
    assignedUserId: null,
    dish,
    cuisine: "Flexible",
    technique: "assembly",
    preparationBasis: "guided_method",
    preparationMethod: `Prepare ${dish} as described.`,
    ingredientRequirements: [
      {
        item: "Salt",
        category: "Pantry",
        quantity: null,
        unit: null,
        optional: false,
        inventoryEntryId: saltId,
      },
    ],
    recipeId: null,
    recipeTitle: null,
    recipeUrl: null,
    servings: 2,
    leftoverServings: 0,
    leftoverFromMealId: null,
    packedLunch: false,
    workplaceMeal: false,
    workplaceFriendly: true,
    intensity: "moderate",
    prepMinutes: 30,
    plannedYield: "2 servings",
    rationale: `A practical ${mealType} for both people.`,
    notes: null,
    unscheduledItemId: null,
    inventoryUses: [],
    ...overrides,
  });
}

function validPlan(): WeeklyPlan {
  return weeklyPlanSchema.parse({
    planFormatVersion: 2,
    title: "A practical Saturday",
    summary: "Three balanced meals built around household preferences.",
    strategy: "Keep breakfast light, make lunch satisfying, and use recorded inventory at dinner.",
    meals: [
      meal("breakfast", "breakfast", "Yogurt and fruit"),
      meal("lunch", "lunch", "Grilled cheese and tomato salad"),
      meal("dinner", "dinner", "Prawn tacos", {
        recipeTitle: "Prawn tacos",
        recipeUrl: "https://example.com/prawn-tacos",
        ingredientRequirements: [
          {
            item: "Salt",
            category: "Pantry",
            quantity: null,
            unit: null,
            optional: false,
            inventoryEntryId: saltId,
          },
          {
            item: "Raw shrimp",
            category: "Seafood",
            quantity: 400,
            unit: "g",
            optional: false,
            inventoryEntryId: inventoryId,
          },
          {
            item: "Avocado",
            category: "Produce",
            quantity: 2,
            unit: "each",
            optional: false,
            inventoryEntryId: null,
          },
        ],
        inventoryUses: [
          { inventoryEntryId: inventoryId, ingredient: "Raw shrimp", quantity: 400, unit: "g" },
        ],
      }),
    ],
    coverageExceptions: [],
    shopping: [
      {
        id: "shop-avocado",
        item: "Avocado",
        category: "Produce",
        quantity: 1,
        unit: "each",
        reason: "For the prawn tacos.",
        mealIds: ["dinner"],
        suggestedStore: null,
        saleItemId: null,
        estimatedPrice: null,
      },
    ],
    prepTasks: [
      {
        id: "prep-salsa",
        task: "Mix the taco salsa.",
        mealDate: testDate,
        minutes: 10,
        mealIds: ["dinner"],
      },
    ],
    warnings: [],
  });
}

function request(): WeeklyPlanRequest {
  return {
    startDate: testDate,
    endDate: testDate,
    startMeal: "breakfast",
    endMeal: "dinner",
    planningMode: "balanced",
    notes: "",
    includeSnacks: true,
    includeDesserts: true,
    discoverRecipes: true,
  };
}

function context(): PlanningContext {
  return {
    today: contextDate,
    timeZone: "America/Vancouver",
    users: [
      { id: ownerId, displayName: "Alex" },
      { id: memberId, displayName: "Morgan" },
    ],
    inventory: [
      {
        id: inventoryId,
        ingredient: "Raw shrimp",
        brandVariety: null,
        category: "Seafood",
        quantity: "400.000",
        unit: "g",
        packageState: "sealed",
        priority: "use_soon",
        locationName: "Freezer",
        storageDetail: "Top shelf",
        bestBefore: null,
        notes: null,
        directMealUse: null,
      },
      {
        id: saltId,
        ingredient: "Salt",
        brandVariety: null,
        category: "Pantry",
        quantity: null,
        unit: null,
        packageState: "opened",
        priority: "normal",
        locationName: "Pantry",
        storageDetail: null,
        bestBefore: null,
        notes: null,
        directMealUse: null,
      },
      {
        id: avocadoInventoryId,
        ingredient: "Avocado",
        brandVariety: null,
        category: "Produce",
        quantity: "1.000",
        unit: "each",
        packageState: "opened",
        priority: "normal",
        locationName: "Fridge",
        storageDetail: null,
        bestBefore: null,
        notes: null,
        directMealUse: null,
      },
    ],
    flavorAssets: [],
    preferences: [],
    feedback: [],
    recentMeals: [],
    existingMeals: [],
    unscheduled: [],
    shopping: [],
    recipes: [],
    activeSales: [],
    saleOpportunitySummary: { eligibleCount: 0, suppliedCount: 0, priorityCount: 0 },
  };
}

async function createDatabase() {
  const database = new PGlite();
  for (const migration of [
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
  ]) {
    await database.exec(await fs.readFile(`drizzle/${migration}.sql`, "utf8"));
  }
  const client = {
    query: (text: string, values?: unknown[]) => database.query(text, values),
    release: () => undefined,
  };
  state.pool = {
    connect: async () => client,
    query: (text: string, values?: unknown[]) => database.query(text, values),
  };
  await database.query(
    "INSERT INTO households (id,name,timezone) VALUES ($1,'Kitchen','America/Vancouver')",
    [householdId],
  );
  await database.query(
    "INSERT INTO household_users (id,household_id,display_name,role) VALUES ($1,$3,'Alex','owner'),($2,$3,'Morgan','member')",
    [ownerId, memberId, householdId],
  );
  await database.query(
    "INSERT INTO storage_locations (id,household_id,name,detail) VALUES ($1,$2,'Freezer','Top shelf')",
    [freezerId, householdId],
  );
  await database.query(
    "INSERT INTO inventory_entries (id,household_id,ingredient,category,quantity,unit,package_state,priority) VALUES ($1,$2,'Raw shrimp','Seafood',400,'g','sealed','use_soon')",
    [inventoryId, householdId],
  );
  await database.query(
    "INSERT INTO inventory_entries (id,household_id,ingredient,category,quantity,unit,package_state,priority) VALUES ($1,$2,'Salt','Pantry',NULL,NULL,'opened','normal')",
    [saltId, householdId],
  );
  await database.query(
    "INSERT INTO inventory_entries (id,household_id,ingredient,category,quantity,unit,package_state,priority) VALUES ($1,$2,'Avocado','Produce',1,'each','opened','normal')",
    [avocadoInventoryId, householdId],
  );
  await database.query(
    "INSERT INTO inventory_entries (id,household_id,ingredient,category,quantity,unit,storage_location_id,package_state,priority,notes) VALUES ($1,$2,'Frozen pizza','Frozen',1,'each',$3,'sealed','normal','Bake according to package directions')",
    [pizzaId, householdId, freezerId],
  );
  await database.query(
    "INSERT INTO unscheduled_items (id,household_id,week_start,item_type,title,status) VALUES ($1,$2,$3,'dinner','Prawn tacos','planned')",
    [unscheduledId, householdId, testDate],
  );
  return database;
}

describe("premium weekly planning", () => {
  beforeEach(() => {
    state.pool = null;
    state.responses = [];
    state.calls = [];
  });

  it("queues the request, uses balanced Terra at medium effort, versions review edits, and commits only after explicit conflict replacement", async () => {
    const database = await createDatabase();
    const plan = validPlan();
    plan.meals[2].unscheduledItemId = unscheduledId;
    state.responses.push(
      {
        value: {
          detectedLanguage: "Spanish",
          wasTranslated: true,
          normalizedEnglish: "Use the shrimp and keep dinner light.",
        },
        usage: usage("gpt-5.4-mini", "low"),
        sources: [],
      },
      {
        value: plan,
        usage: usage("gpt-5.6-terra", "medium"),
        sources: [{ url: "https://example.com/prawn-tacos", title: "Prawn tacos" }],
      },
    );

    const queued = await queueWeeklyPlan(actor, {
      ...request(),
      notes: "Usa los camarones y mantén la cena ligera.",
    });
    expect(queued.status).toBe("queued");
    expect(state.calls).toHaveLength(0);
    await expect(queueWeeklyPlan(actor, request())).rejects.toThrow(/already being generated/i);
    const finished = await processWeeklyPlanJob(queued.id);
    expect(finished).toMatchObject({ status: "completed", stage: "completed" });
    expect(finished.planId).toBeTruthy();
    const generated = {
      id: finished.planId!,
      issues: (
        await database.query<{ issues: unknown[] }>(
          `SELECT validation_issues AS issues FROM weekly_plans WHERE id=$1`,
          [finished.planId],
        )
      ).rows[0].issues,
    };
    expect(generated.issues).toEqual([]);
    expect(state.calls.map((call) => call.modelTier)).toEqual(["economy", "balanced"]);
    expect(state.calls[1].maxOutputTokens).toBe(32_000);
    expect(state.calls[1].webSearch).toBe(true);
    expect(String(state.calls[1].input)).toContain("Use the shrimp and keep dinner light.");
    expect(String(state.calls[1].input)).not.toContain("Usa los camarones");
    expect(String(state.calls[1].input)).toContain('"ingredient":"Frozen pizza"');
    expect(String(state.calls[1].input)).toContain('"role":"complete_meal"');
    expect(String(state.calls[1].input)).toContain('"recipeRequired":false');
    const runs = await database.query<{ tier: string; model: string; effort: string }>(
      `SELECT model_tier AS tier,model,reasoning_effort AS effort FROM ai_runs ORDER BY created_at,id`,
    );
    expect(runs.rows).toEqual([
      { tier: "economy", model: "gpt-5.4-mini", effort: "low" },
      { tier: "balanced", model: "gpt-5.6-terra", effort: "medium" },
    ]);
    const sources = await database.query<{ url: string; domain: string }>(
      `SELECT source_url AS url,source_domain AS domain FROM weekly_plan_recipe_sources WHERE weekly_plan_id=$1`,
      [generated.id],
    );
    expect(sources.rows).toEqual([
      { url: "https://example.com/prawn-tacos", domain: "example.com" },
    ]);

    const edited = structuredClone(plan);
    edited.title = "Edited Saturday plan";
    edited.meals[1].dish = "Aged-cheddar grilled cheese";
    const revised = await reviseWeeklyPlan(actor, generated.id, { payload: edited });
    expect(revised.revisionNumber).toBe(2);
    const restored = await restoreWeeklyPlanRevision(actor, generated.id, { revisionNumber: 1 });
    expect(restored.revisionNumber).toBe(3);
    expect(restored.payload.title).toBe(plan.title);
    const revisions = await database.query<{ revision: number; source: string }>(
      `SELECT revision_number AS revision,source FROM weekly_plan_revisions ORDER BY revision_number`,
    );
    expect(revisions.rows).toEqual([
      { revision: 1, source: "ai" },
      { revision: 2, source: "ui" },
      { revision: 3, source: "restore" },
    ]);

    await database.query(
      "INSERT INTO meal_plan_entries (household_id,meal_date,meal_type,dish,status) VALUES ($1,$2,'breakfast','Old breakfast','planned')",
      [householdId, testDate],
    );
    await expect(commitWeeklyPlan(actor, generated.id, { replaceExisting: false })).rejects.toThrow(
      "Confirm replacement",
    );
    expect(
      (
        await database.query<{ status: string }>("SELECT status FROM weekly_plans WHERE id=$1", [
          generated.id,
        ])
      ).rows[0].status,
    ).toBe("draft");

    const committed = await commitWeeklyPlan(actor, generated.id, { replaceExisting: true });
    expect(committed).toMatchObject({
      status: "committed",
      mealCount: 3,
      prepTaskCount: 1,
      shoppingCreated: 1,
      replacedMeals: 1,
    });
    const meals = await database.query<{ dish: string; mealType: string; weeklyPlanId: string }>(
      `SELECT dish,meal_type AS "mealType",weekly_plan_id AS "weeklyPlanId" FROM meal_plan_entries ORDER BY meal_type`,
    );
    expect(meals.rows).toHaveLength(4);
    expect(meals.rows.every((entry) => entry.weeklyPlanId === generated.id)).toBe(true);
    expect(meals.rows.some((entry) => entry.dish === "Old breakfast")).toBe(false);
    expect(
      meals.rows.some((entry) => entry.mealType === "prep" && entry.dish === "Mix the taco salsa."),
    ).toBe(true);
    const committedUses = (
      await database.query<{
        uses: Array<{
          inventoryEntryId: string | null;
          ingredient: string;
          quantity: number | null;
          unit: string | null;
        }>;
      }>(
        `SELECT planned_inventory_uses AS uses FROM meal_plan_entries WHERE weekly_plan_id=$1 AND dish='Prawn tacos'`,
        [generated.id],
      )
    ).rows[0].uses;
    expect(committedUses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventoryEntryId: inventoryId,
          ingredient: "Raw shrimp",
          quantity: 400,
          unit: "g",
        }),
        expect.objectContaining({
          inventoryEntryId: avocadoInventoryId,
          ingredient: "Avocado",
          quantity: 1,
          unit: "each",
        }),
        expect.objectContaining({
          inventoryEntryId: null,
          ingredient: "Avocado",
          quantity: 1,
          unit: "each",
        }),
      ]),
    );
    const shopping = (
      await database.query<{ item: string; weeklyPlanId: string }>(
        `SELECT item,weekly_plan_id AS "weeklyPlanId" FROM shopping_items`,
      )
    ).rows[0];
    expect(shopping).toEqual({ item: "Avocado", weeklyPlanId: generated.id });
    expect(
      (
        await database.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM unscheduled_items WHERE id=$1`,
          [unscheduledId],
        )
      ).rows[0].count,
    ).toBe(0);
    const auditActions = await database.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE entity_type IN ('weekly_plan','meal_plan_entry','shopping_item')`,
    );
    expect(auditActions.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["propose", "revise", "restore", "replace", "create", "commit"]),
    );
    expect(
      (
        await database.query<{ action: string }>(
          `SELECT action FROM audit_events WHERE entity_type='unscheduled_item' AND entity_id=$1`,
          [unscheduledId],
        )
      ).rows[0].action,
    ).toBe("schedule");
    await database.close();
  }, 30_000);

  it("preserves reviewed edits to an automatically generated draft shopping item", async () => {
    const database = await createDatabase();
    state.responses.push({
      value: validPlan(),
      usage: usage("gpt-5.6-terra", "medium"),
      sources: [],
    });

    const queued = await queueWeeklyPlan(actor, request());
    const finished = await processWeeklyPlanJob(queued.id);
    const generated = (await listWeeklyPlans(actor.householdId)).find(
      (plan) => plan.id === finished.planId,
    )!;
    const automatic = generated.payload.shopping.find((line) =>
      line.id.startsWith("auto-requirement-"),
    )!;
    expect(automatic).toMatchObject({ item: "Avocado", quantity: 1, unit: "each" });

    const edited = structuredClone(generated.payload);
    const reviewed = edited.shopping.find((line) => line.id === automatic.id)!;
    reviewed.item = "Hass avocados";
    reviewed.category = "Produce specials";
    reviewed.quantity = 2;
    reviewed.reason = "Buy a two-pack for the prawn tacos.";

    const revised = await reviseWeeklyPlan(actor, generated.id, { payload: edited });
    expect(revised.payload.shopping).toContainEqual(
      expect.objectContaining({
        item: "Hass avocados",
        category: "Produce specials",
        quantity: 2,
        unit: "each",
        reason: "Buy a two-pack for the prawn tacos.",
      }),
    );
    expect(revised.payload.shopping[0].id).toMatch(/^manual-shopping-/);
    await database.close();
  }, 30_000);

  it("blocks missing coverage, overlapping assignments, unsafe workplace food, excessive prep, and insufficient leftovers", () => {
    const plan = validPlan();
    plan.meals = plan.meals.filter((entry) => entry.mealType !== "breakfast");
    plan.meals.push(meal("household-lunch", "lunch", "Shared lunch"));
    plan.meals.push(meal("member-lunch", "lunch", "Member lunch", { assignedUserId: memberId }));
    plan.meals[0] = { ...plan.meals[0], workplaceMeal: true, workplaceFriendly: false };
    plan.meals[1] = { ...plan.meals[1], prepMinutes: 180, leftoverServings: 1 };
    plan.meals.push(
      meal("leftovers", "dinner", "Dinner leftovers", {
        leftoverFromMealId: plan.meals[1].id,
        servings: 2,
      }),
    );
    const issues = validateWeeklyPlan(plan, request(), context());
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "missing_meal_slot",
        "overlapping_meal_slot",
        "workplace_food",
        "leftover_shortfall",
      ]),
    );
  });

  it("allows an explicit person absence and enforces snack and dessert choices", () => {
    const plan = validPlan();
    plan.meals[2].assignedUserId = ownerId;
    plan.meals[2].servings = 1;
    plan.coverageExceptions = [
      {
        id: "member-away",
        mealDate: testDate,
        mealType: "dinner",
        userId: memberId,
        reason: "The member is eating elsewhere.",
      },
    ];
    expect(
      validateWeeklyPlan(plan, request(), context()).filter((issue) => issue.severity === "error"),
    ).toEqual([]);

    plan.meals.push(meal("snack", "snack", "Popcorn"));
    plan.meals.push(meal("dessert", "dessert", "Cookie bar"));
    const excluded = { ...request(), includeSnacks: false, includeDesserts: false };
    expect(validateWeeklyPlan(plan, excluded, context()).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["unexpected_snack", "unexpected_dessert"]),
    );
  });

  it("rounds countable same-unit inventory shortfalls and adds measured shortages exactly", () => {
    const plan = validPlan();
    const household = context();
    const shortages = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        ingredient: "Cucumbers",
        category: "Produce",
        quantity: "2.000",
        unit: "bag",
        used: 3.625,
      },
      {
        id: "22222222-1111-4111-8111-111111111111",
        ingredient: "Dill",
        category: "Produce",
        quantity: "1.000",
        unit: "bag",
        used: 1.5,
      },
      {
        id: "33333333-1111-4111-8111-111111111111",
        ingredient: "Bananas",
        category: "Produce",
        quantity: "1.000",
        unit: "each",
        used: 3,
      },
      {
        id: "44444444-1111-4111-8111-111111111111",
        ingredient: "Fresh mozzarella",
        category: "Dairy",
        quantity: "190.000",
        unit: "g",
        used: 285,
      },
    ];
    for (const item of shortages)
      household.inventory.push({
        ...item,
        brandVariety: null,
        packageState: "opened",
        priority: "normal",
        locationName: "Fridge",
        storageDetail: null,
        bestBefore: null,
        notes: null,
        directMealUse: null,
      });
    plan.meals[2].inventoryUses.push(
      ...shortages.map((item) => ({
        inventoryEntryId: item.id,
        ingredient: item.ingredient,
        quantity: item.used,
        unit: item.unit,
      })),
    );
    const reconciled = reconcileSameUnitShoppingShortfalls(plan, household);
    expect(reconciled.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item: "Cucumbers", quantity: 2, unit: "bag" }),
        expect.objectContaining({ item: "Dill", quantity: 1, unit: "bag" }),
        expect.objectContaining({ item: "Bananas", quantity: 2, unit: "each" }),
        expect.objectContaining({ item: "Fresh mozzarella", quantity: 95, unit: "g" }),
      ]),
    );
    expect(
      reconciled.plan.shopping
        .filter((item) => item.id.startsWith("auto-shortfall-"))
        .map((item) => ({ item: item.item, quantity: item.quantity, unit: item.unit })),
    ).toEqual([
      { item: "Cucumbers", quantity: 2, unit: "bag" },
      { item: "Dill", quantity: 1, unit: "bag" },
      { item: "Bananas", quantity: 2, unit: "each" },
      { item: "Fresh mozzarella", quantity: 95, unit: "g" },
    ]);
    expect(
      validateWeeklyPlan(reconciled.plan, request(), household).filter(
        (issue) => issue.code === "inventory_shortfall",
      ),
    ).toEqual([]);
  });

  it("uses convertible inventory units and does not call a recorded container zero stock", () => {
    const plan = validPlan();
    const household = context();
    household.inventory.push(
      {
        id: yogurtInventoryId,
        ingredient: "Plain Greek yogurt",
        brandVariety: null,
        category: "Dairy",
        quantity: "1.500",
        unit: "kg",
        packageState: "opened",
        priority: "normal",
        locationName: "Fridge",
        storageDetail: "Middle shelf",
        bestBefore: null,
        notes: null,
        directMealUse: null,
      },
      {
        id: tahiniInventoryId,
        ingredient: "Tahini",
        brandVariety: null,
        category: "Sauces",
        quantity: "1.000",
        unit: "jar",
        packageState: "opened",
        priority: "normal",
        locationName: "Fridge",
        storageDetail: "Door",
        bestBefore: null,
        notes: null,
        directMealUse: null,
      },
    );
    plan.meals[0].ingredientRequirements = [
      {
        item: "Greek yogurt",
        category: "Dairy",
        quantity: 750,
        unit: "g",
        optional: false,
        inventoryEntryId: null,
      },
      {
        item: "Tahini",
        category: "Sauces",
        quantity: 2,
        unit: "tbsp",
        optional: false,
        inventoryEntryId: null,
      },
    ];
    const reconciled = reconcileWeeklyPlanShopping(plan, household);
    expect(
      reconciled.plan.shopping.filter((line) => ["Greek yogurt", "Tahini"].includes(line.item)),
    ).toEqual([]);
    expect(reconciled.plan.meals[0].ingredientRequirements).toEqual([
      expect.objectContaining({ item: "Greek yogurt", inventoryEntryId: yogurtInventoryId }),
      expect.objectContaining({ item: "Tahini", inventoryEntryId: tahiniInventoryId }),
    ]);
    expect(reconciled.plan.meals[0].inventoryUses).toEqual(
      expect.arrayContaining([
        {
          inventoryEntryId: yogurtInventoryId,
          ingredient: "Greek yogurt",
          quantity: 0.75,
          unit: "kg",
        },
        { inventoryEntryId: tahiniInventoryId, ingredient: "Tahini", quantity: null, unit: "jar" },
      ]),
    );
    expect(reconciled.plan.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/Tahini.+1 jar.+2 tbsp.+confirm/i)]),
    );
  });

  it("converts measured inventory before adding only the true shortfall", () => {
    const plan = validPlan();
    const household = context();
    household.inventory.push({
      id: yogurtInventoryId,
      ingredient: "Plain Greek yogurt",
      brandVariety: null,
      category: "Dairy",
      quantity: "1.500",
      unit: "kg",
      packageState: "opened",
      priority: "normal",
      locationName: "Fridge",
      storageDetail: "Middle shelf",
      bestBefore: null,
      notes: null,
      directMealUse: null,
    });
    plan.meals[0].ingredientRequirements = [
      {
        item: "Greek yogurt",
        category: "Dairy",
        quantity: 2000,
        unit: "g",
        optional: false,
        inventoryEntryId: null,
      },
    ];
    const reconciled = reconcileWeeklyPlanShopping(plan, household);
    expect(reconciled.plan.meals[0].inventoryUses).toEqual([
      {
        inventoryEntryId: yogurtInventoryId,
        ingredient: "Greek yogurt",
        quantity: 1.5,
        unit: "kg",
      },
    ]);
    expect(reconciled.plan.shopping).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item: "Greek yogurt", quantity: 500, unit: "g" }),
      ]),
    );
  });

  it("accepts an excessive model warning list and bounds it before persistence", () => {
    const modelPlan = validPlan();
    modelPlan.warnings = Array.from({ length: 35 }, (_, index) => `Model warning ${index + 1}.`);
    const materialized = materializeGeneratedWeeklyPlan(modelPlan);
    expect(materialized.warnings).toHaveLength(30);
    expect(materialized.warnings.slice(0, 2)).toEqual(["Model warning 1.", "Model warning 2."]);
    expect(materialized.warnings.at(-1)).toMatch(
      /Additional planner warnings omitted: 6 additional distinct warnings were condensed/i,
    );
    expect(() => weeklyPlanSchema.parse(materialized)).not.toThrow();
  });

  it("bounds many deterministic container confirmations instead of failing plan generation", () => {
    const plan = validPlan();
    const household = context();
    const ambiguous = Array.from({ length: 35 }, (_, index) => {
      const ingredient = `Jarred ingredient ${index + 1}`;
      const id = `20000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
      household.inventory.push({
        id,
        ingredient,
        brandVariety: null,
        category: "Pantry",
        quantity: "1.000",
        unit: "jar",
        packageState: "opened",
        priority: "normal",
        locationName: "Pantry",
        storageDetail: null,
        bestBefore: null,
        notes: null,
        directMealUse: null,
      });
      return {
        item: ingredient,
        category: "Pantry",
        quantity: 1,
        unit: "tsp",
        optional: false,
        inventoryEntryId: id,
      };
    });
    plan.meals.forEach((entry, index) => {
      entry.ingredientRequirements = ambiguous.slice(index * 12, (index + 1) * 12);
    });
    const reconciled = reconcileWeeklyPlanShopping(plan, household);
    expect(
      reconciled.plan.shopping.filter((line) => line.item.startsWith("Jarred ingredient")),
    ).toEqual([]);
    expect(reconciled.plan.warnings).toHaveLength(30);
    expect(
      reconciled.plan.warnings
        .slice(0, 29)
        .every((warning) => warning.startsWith("Confirm inventory quantity:")),
    ).toBe(true);
    expect(reconciled.plan.warnings.at(-1)).toMatch(
      /Additional planner warnings omitted: 6 additional distinct warnings were condensed/i,
    );
    expect(() => weeklyPlanSchema.parse(reconciled.plan)).not.toThrow();
  });

  it("materializes only model-owned planning fields before deterministic enrichment", () => {
    const modelPlan = validPlan();
    modelPlan.shopping.push({
      id: "model-only",
      item: "Chocolate",
      category: "Snacks",
      quantity: 1,
      unit: "bar",
      reason: "Model-authored duplicate layer.",
      mealIds: ["dinner"],
      suggestedStore: null,
      saleItemId: null,
      estimatedPrice: null,
    });
    modelPlan.meals[2].inventoryUses = [
      { inventoryEntryId: inventoryId, ingredient: "Raw shrimp", quantity: 999, unit: "g" },
    ];
    const materialized = materializeGeneratedWeeklyPlan(modelPlan);
    expect(materialized.planFormatVersion).toBe(2);
    expect(materialized.shopping).toEqual([]);
    expect(materialized.meals.every((entry) => entry.inventoryUses.length === 0)).toBe(true);
    expect(materialized.reviewScorecard).toMatchObject({ saleItemIdsUsed: [], recentRepeats: [] });
    expect(materialized.meals[2].ingredientRequirements).toEqual(
      modelPlan.meals[2].ingredientRequirements,
    );
  });

  it("turns complete meal requirements into sale-linked shopping and a deterministic variety scorecard", () => {
    const plan = validPlan();
    const household = context();
    const saleId = "abababab-abab-4aba-8aba-abababababab";
    household.activeSales = [
      {
        id: saleId,
        storeName: "H-Mart",
        storeLocation: "Victoria",
        validFrom: testDate,
        validUntil: testDate,
        item: "Cauliflower",
        brand: null,
        category: "Produce",
        packageSize: "1 head",
        price: "2.49",
        regularPrice: "4.99",
        savingsAmount: "2.50",
        discountPercent: "50.10",
        pricingUnit: "each",
        multiBuyQuantity: null,
        memberOnly: false,
        limitText: null,
        notes: null,
        prioritized: true,
        opportunityScore: 132,
        opportunityReasons: ["household priority"],
      },
    ];
    household.saleOpportunitySummary = { eligibleCount: 1, suppliedCount: 1, priorityCount: 1 };
    household.recentMeals = [
      {
        mealDate: "2099-07-10",
        mealType: "dinner",
        person: null,
        dish: "Prawn tacos",
        status: "completed",
        recipeTitle: null,
      },
    ];
    plan.meals[2] = {
      ...plan.meals[2],
      technique: "roasting",
      primaryIngredients: ["Cauliflower", "Raw shrimp"],
      discovery: true,
      saleItemIds: [saleId],
      ingredientRequirements: [
        {
          item: "Raw shrimp",
          category: "Seafood",
          quantity: 400,
          unit: "g",
          optional: false,
          inventoryEntryId: inventoryId,
        },
        {
          item: "Cauliflower",
          category: "Produce",
          quantity: 1,
          unit: "head",
          optional: false,
          inventoryEntryId: null,
        },
        {
          item: "Ricotta",
          category: "Dairy",
          quantity: 250,
          unit: "g",
          optional: false,
          inventoryEntryId: null,
        },
      ],
    };
    const reconciled = reconcileWeeklyPlanShopping(plan, household);
    expect(reconciled.plan.shopping).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "Cauliflower",
          quantity: 1,
          unit: "head",
          saleItemId: saleId,
          suggestedStore: "H-Mart",
          estimatedPrice: 2.49,
        }),
        expect.objectContaining({ item: "Ricotta", quantity: 250, unit: "g", saleItemId: null }),
      ]),
    );
    expect(reconciled.plan.reviewScorecard).toMatchObject({
      qualifiedSalesConsidered: 1,
      prioritySalesConsidered: 1,
      saleItemIdsUsed: [saleId],
      saleLinkedMealIds: ["dinner"],
      useSoonInventoryIdsUsed: [inventoryId],
      discoveryMealIds: ["dinner"],
    });
    expect(reconciled.plan.reviewScorecard.recentRepeats).toEqual([
      expect.objectContaining({ mealId: "dinner", recentDish: "Prawn tacos" }),
    ]);
    const issues = validateWeeklyPlan(reconciled.plan, request(), household, [
      "https://example.com/prawn-tacos",
    ]);
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "recent_meal_repeat", mealId: "dinner" }),
      ]),
    );
  });

  it("commits multiple prep entries on one day and carries generated shopping shortfalls into shopping", async () => {
    const database = await createDatabase();
    const plan = validPlan();
    plan.meals[2].ingredientRequirements = plan.meals[2].ingredientRequirements.map((entry) =>
      entry.item === "Raw shrimp" ? { ...entry, quantity: 600 } : entry,
    );
    plan.meals.push(
      meal("prep-cinnamon", "prep", "Yeasted cinnamon buns"),
      meal("prep-hummus", "prep", "Homemade hummus"),
      meal("prep-bars", "prep", "Chocolate-chip cookie bars"),
    );
    state.responses.push({
      value: plan,
      usage: usage("gpt-5.6-terra", "medium"),
      sources: [{ url: "https://example.com/prawn-tacos", title: "Prawn tacos" }],
    });
    const queued = await queueWeeklyPlan(actor, request());
    const finished = await processWeeklyPlanJob(queued.id);
    const planId = finished.planId!;
    const committed = await commitWeeklyPlan(actor, planId, { replaceExisting: false });
    expect(committed).toMatchObject({
      status: "committed",
      mealCount: 6,
      prepTaskCount: 1,
      replacedMeals: 0,
      shoppingCreated: 2,
    });
    const prep = await database.query<{ dish: string }>(
      `SELECT dish FROM meal_plan_entries WHERE weekly_plan_id=$1 AND meal_type='prep' ORDER BY dish`,
      [planId],
    );
    expect(prep.rows.map((row) => row.dish)).toEqual([
      "Chocolate-chip cookie bars",
      "Homemade hummus",
      "Mix the taco salsa.",
      "Yeasted cinnamon buns",
    ]);
    const shrimp = await database.query<{ quantity: string; unit: string }>(
      `SELECT quantity::text AS quantity,unit FROM shopping_items WHERE weekly_plan_id=$1 AND item='Raw shrimp'`,
      [planId],
    );
    expect(shrimp.rows).toEqual([{ quantity: "200.000", unit: "g" }]);
    const stored = await database.query<{ revisionNumber: number; payload: WeeklyPlan }>(
      `SELECT revision_number AS "revisionNumber",current_payload AS payload FROM weekly_plans WHERE id=$1`,
      [planId],
    );
    expect(stored.rows[0].revisionNumber).toBe(1);
    expect(
      stored.rows[0].payload.shopping.some(
        (item) => item.item === "Raw shrimp" && item.quantity === 200,
      ),
    ).toBe(true);
    await database.close();
  }, 30_000);

  it("cancels a queued generation and retries it as a distinct durable job without changing planning mode", async () => {
    const database = await createDatabase();
    const queued = await queueWeeklyPlan(actor, { ...request(), planningMode: "deep" });
    const cancelled = await cancelWeeklyPlanJob(actor, queued.id);
    expect(cancelled).toMatchObject({
      status: "cancelled",
      stage: "cancelled",
      planningMode: "deep",
    });
    const retried = await retryWeeklyPlanJob(actor, queued.id);
    expect(retried).toMatchObject({
      status: "queued",
      stage: "queued",
      planningMode: "deep",
      retryOfJobId: queued.id,
    });
    expect(retried.id).not.toBe(queued.id);
    expect((await listWeeklyPlanJobs(householdId)).map((job) => job.id)).toEqual([retried.id]);
    expect(
      (
        await database.query<{ action: string; reason: string }>(
          `SELECT action,reason FROM audit_events WHERE entity_type='weekly_plan_job' AND entity_id=$1 ORDER BY created_at DESC LIMIT 1`,
          [queued.id],
        )
      ).rows[0],
    ).toEqual({
      action: "retry",
      reason: "Retried weekly plan and dismissed the prior attempt from Planner",
    });
    await database.close();
  }, 30_000);

  it("continues the same durable job with Terra when Sol times out", async () => {
    const database = await createDatabase();
    const timeout = new Error("Request timed out.");
    timeout.name = "APIConnectionTimeoutError";
    state.responses.push(timeout, {
      value: validPlan(),
      usage: usage("gpt-5.6-terra", "medium"),
      sources: [{ url: "https://example.com/prawn-tacos", title: "Prawn tacos" }],
    });
    const queued = await queueWeeklyPlan(actor, { ...request(), planningMode: "deep" });
    const finished = await processWeeklyPlanJob(queued.id);
    expect(finished).toMatchObject({
      status: "completed",
      stage: "completed",
      model: "gpt-5.6-terra",
    });
    expect(state.calls.map((call) => call.modelTier)).toEqual(["planning", "fallback"]);
    expect(state.calls.map((call) => call.maxOutputTokens)).toEqual([48_000, 32_000]);
    expect(state.calls[1]).toMatchObject({ timeoutMs: 1_800_000, webSearch: true });
    const runs = await database.query<{
      tier: string;
      model: string;
      status: string;
      triggerReason: string | null;
    }>(
      `SELECT model_tier AS tier,model,status,trigger_reason AS "triggerReason" FROM ai_runs ORDER BY created_at,id`,
    );
    expect(runs.rows).toEqual([
      { tier: "planning", model: "gpt-5.6-sol", status: "failed", triggerReason: null },
      {
        tier: "fallback",
        model: "gpt-5.6-terra",
        status: "completed",
        triggerReason:
          "gpt-5.6-sol deep planning request timed out; continuing with gpt-5.6-terra.",
      },
    ]);
    await database.close();
  }, 30_000);

  it("fails a balanced plan visibly without silently escalating it to Sol", async () => {
    const database = await createDatabase();
    const timeout = new Error("Request timed out.");
    timeout.name = "APIConnectionTimeoutError";
    state.responses.push(timeout);
    const queued = await queueWeeklyPlan(actor, request());
    const finished = await processWeeklyPlanJob(queued.id);
    expect(finished).toMatchObject({
      status: "failed",
      stage: "failed",
      planningMode: "balanced",
      errorMessage: "Request timed out.",
    });
    expect(state.calls.map((call) => call.modelTier)).toEqual(["balanced"]);
    const runs = await database.query<{ tier: string; model: string; status: string }>(
      `SELECT model_tier AS tier,model,status FROM ai_runs`,
    );
    expect(runs.rows).toEqual([{ tier: "balanced", model: "gpt-5.6-terra", status: "failed" }]);
    await database.close();
  }, 30_000);

  it("dismisses a failed plan from the Planner while retaining AI diagnostics and audit history", async () => {
    const database = await createDatabase();
    const timeout = new Error("Request timed out.");
    timeout.name = "APIConnectionTimeoutError";
    state.responses.push(timeout);
    const queued = await queueWeeklyPlan(actor, request());
    const failed = await processWeeklyPlanJob(queued.id);
    expect((await listWeeklyPlanJobs(householdId)).map((job) => job.id)).toContain(failed.id);

    const dismissed = await dismissWeeklyPlanJob(actor, failed.id);
    expect(dismissed).toMatchObject({ id: failed.id, status: "failed" });
    expect((await listWeeklyPlanJobs(householdId)).map((job) => job.id)).not.toContain(failed.id);
    expect(
      (
        await database.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM ai_runs WHERE job_id=$1`,
          [failed.id],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await database.query<{ action: string; reason: string }>(
          `SELECT action,reason FROM audit_events WHERE entity_type='weekly_plan_job' AND entity_id=$1 ORDER BY created_at DESC LIMIT 1`,
          [failed.id],
        )
      ).rows[0],
    ).toEqual({
      action: "dismiss",
      reason: "Dismissed failed weekly plan from Planner",
    });
    await expect(dismissWeeklyPlanJob(actor, failed.id)).rejects.toThrow(/already dismissed/i);
    await database.close();
  }, 30_000);

  it("archives an uncommitted proposal, hides it from the Planner, and preserves its audit trail", async () => {
    const database = await createDatabase();
    state.responses.push({
      value: validPlan(),
      usage: usage("gpt-5.6-terra", "medium"),
      sources: [],
    });
    const queued = await queueWeeklyPlan(actor, request());
    const finished = await processWeeklyPlanJob(queued.id);
    const planId = finished.planId!;
    expect((await listWeeklyPlans(householdId)).some((plan) => plan.id === planId)).toBe(true);
    const archived = await archiveWeeklyPlan(actor, planId);
    expect(archived).toMatchObject({ id: planId, status: "draft" });
    expect(
      (
        await database.query<{ archivedAt: Date | null }>(
          `SELECT archived_at AS "archivedAt" FROM weekly_plans WHERE id=$1`,
          [planId],
        )
      ).rows[0].archivedAt,
    ).toBeInstanceOf(Date);
    expect((await listWeeklyPlans(householdId)).some((plan) => plan.id === planId)).toBe(false);
    expect((await listWeeklyPlanJobs(householdId)).some((job) => job.planId === planId)).toBe(
      false,
    );
    expect(
      (
        await database.query<{ action: string; reason: string }>(
          `SELECT action,reason FROM audit_events WHERE entity_type='weekly_plan' AND entity_id=$1 ORDER BY created_at DESC LIMIT 1`,
          [planId],
        )
      ).rows[0],
    ).toEqual({ action: "archive", reason: "Archived proposed weekly plan" });
    await expect(archiveWeeklyPlan(actor, planId)).rejects.toThrow(/already archived/i);
    await database.query(
      `UPDATE weekly_plans SET archived_at=NULL,status='committed' WHERE id=$1`,
      [planId],
    );
    await expect(archiveWeeklyPlan(actor, planId)).rejects.toThrow(/cannot be archived/i);
    await database.close();
  }, 30_000);
});
