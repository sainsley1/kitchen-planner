import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  weeklyPlanMealSchema,
  weeklyPlanRefinementSchema,
  weeklyPlanSchema,
  type WeeklyPlan,
} from "../lib/ai/contracts";

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
    if (!response) throw new Error("Missing mocked response");
    if (response instanceof Error) throw response;
    return response;
  }),
  isAiMaxOutputTokensError: (error: unknown) =>
    error instanceof Error &&
    (error as Error & { incompleteReason?: string }).incompleteReason === "max_output_tokens",
  aiUsageFromError: (error: unknown) =>
    error instanceof Error
      ? (error as Error & { usage?: Record<string, unknown> }).usage
      : undefined,
}));
import {
  applyWeeklyPlanSuggestion,
  createWeeklyPlanSuggestion,
  mergeRefinement,
  refineWeeklyPlan,
} from "../lib/services/weekly-refinement";
import { normalizeWeeklyPlanMealLinkedRecords } from "../lib/services/weekly-shopping";

const householdId = "22222222-2222-4222-8222-222222222222";
const ownerId = "99999999-9999-4999-8999-999999999999";
const memberId = "88888888-8888-4888-8888-888888888888";
const actor = { householdId, userId: ownerId, displayName: "Alex", role: "owner" as const };
const yogurtInventoryId = "14141414-1414-4141-8141-141414141414";
const tahiniInventoryId = "15151515-1515-4151-8151-151515151515";
function usage(model: string) {
  return {
    responseId: `response-${state.calls.length}`,
    model,
    reasoningEffort: "low",
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 50,
    totalTokens: 150,
    estimatedCostUsd: 0.001,
    latencyMs: 10,
    webSearchCalls: 0,
    webSourceCount: 0,
  };
}
function maxOutputError(responseId: string, outputTokens: number, reasoningTokens: number) {
  const error = new Error(
    `OpenAI returned an incomplete structured response (max_output_tokens) after ${outputTokens.toLocaleString("en-CA")} output tokens. Response ID: ${responseId}.`,
  ) as Error & {
    incompleteReason: string;
    usage: ReturnType<typeof usage> & { reasoningTokens: number };
  };
  error.incompleteReason = "max_output_tokens";
  error.usage = {
    ...usage("gpt-5.4"),
    responseId,
    inputTokens: 2_000,
    outputTokens,
    totalTokens: 2_000 + outputTokens,
    reasoningTokens,
  };
  return error;
}
function meal(id: string, type: "lunch" | "dinner", dish: string): WeeklyPlan["meals"][number] {
  return weeklyPlanMealSchema.parse({
    id,
    mealDate: "2026-07-18",
    mealType: type,
    assignedUserId: null,
    dish,
    cuisine: "Flexible",
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
    rationale: "Fits the household plan.",
    notes: null,
    unscheduledItemId: null,
    inventoryUses: [],
  });
}
function plan(): WeeklyPlan {
  return weeklyPlanSchema.parse({
    title: "Draft",
    summary: "A focused draft.",
    strategy: "Keep the day balanced.",
    meals: [meal("lunch", "lunch", "Grilled cheese"), meal("dinner", "dinner", "Prawn tacos")],
    coverageExceptions: [],
    shopping: [
      {
        id: "shared-limes",
        item: "Limes",
        category: "Produce",
        quantity: 2,
        unit: "each",
        reason: "Used at lunch and dinner.",
        mealIds: ["lunch", "dinner"],
        suggestedStore: null,
        saleItemId: null,
        estimatedPrice: null,
      },
    ],
    prepTasks: [],
    warnings: [],
  });
}
async function database(payload: WeeklyPlan = plan()) {
  const db = new PGlite();
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
    await db.exec(await fs.readFile(`drizzle/${name}.sql`, "utf8"));
  const client = {
    query: (text: string, values?: unknown[]) => db.query(text, values),
    release: () => undefined,
  };
  state.pool = { connect: async () => client, query: client.query };
  await db.query(
    "INSERT INTO households (id,name,timezone) VALUES ($1,'Kitchen','America/Vancouver')",
    [householdId],
  );
  await db.query(
    "INSERT INTO household_users (id,household_id,display_name,role) VALUES ($1,$3,'Alex','owner'),($2,$3,'Morgan','member')",
    [ownerId, memberId, householdId],
  );
  const job = (
    await db.query<{ id: string }>(
      "INSERT INTO ai_jobs (household_id,actor_user_id,workflow,status,input_snapshot,completed_at) VALUES ($1,$2,'weekly_planning','completed','{}',now()) RETURNING id",
      [householdId, ownerId],
    )
  ).rows[0];
  const weekly = (
    await db.query<{ id: string }>(
      `INSERT INTO weekly_plans (household_id,job_id,created_by,start_date,end_date,start_meal,end_meal,status,current_payload,validation_issues,normalized_request) VALUES ($1,$2,$3,'2026-07-18','2026-07-18','lunch','dinner','draft',$4::jsonb,'[]','') RETURNING id`,
      [householdId, job.id, ownerId, JSON.stringify(payload)],
    )
  ).rows[0];
  await db.query(
    `INSERT INTO weekly_plan_revisions (weekly_plan_id,revision_number,payload,validation_issues,source,created_by,summary) VALUES ($1,1,$2::jsonb,'[]','ai',$3,'Initial AI plan')`,
    [weekly.id, JSON.stringify(payload), ownerId],
  );
  return { db, id: weekly.id };
}

describe("targeted weekly-plan refinement", () => {
  beforeEach(() => {
    state.pool = null;
    state.responses = [];
    state.calls = [];
  });
  it("reconciles repeated meal regeneration prep tasks while preserving unrelated tasks", () => {
    let current = plan();
    current.prepTasks = [
      {
        id: "obsolete-dinner",
        task: "Old dinner prep.",
        mealDate: "2026-07-18",
        minutes: 20,
        mealIds: ["dinner"],
      },
      {
        id: "shared-prep",
        task: "Shared prep that still supports lunch.",
        mealDate: "2026-07-18",
        minutes: 15,
        mealIds: ["lunch", "dinner"],
      },
      {
        id: "unrelated-lunch",
        task: "Lunch-only prep.",
        mealDate: "2026-07-18",
        minutes: 10,
        mealIds: ["lunch"],
      },
      {
        id: "obsolete-dinner",
        task: "Pre-existing duplicate dinner prep.",
        mealDate: "2026-07-18",
        minutes: 5,
        mealIds: ["dinner"],
      },
    ];
    const replacement = weeklyPlanRefinementSchema.parse({
      summary: "Regenerated dinner.",
      replacementMeals: [meal("dinner", "dinner", "Regenerated dinner")],
      replacementShopping: [],
      replacementPrepTasks: [
        {
          id: "shared-prep",
          task: "Current regenerated dinner prep.",
          mealDate: "2026-07-18",
          minutes: 12,
          mealIds: ["dinner"],
        },
      ],
      warnings: [],
    });

    for (let repetition = 0; repetition < 4; repetition += 1)
      current = normalizeWeeklyPlanMealLinkedRecords(
        mergeRefinement(current, new Set(["dinner"]), replacement),
      );

    expect(current.prepTasks.filter((task) => task.mealIds.includes("dinner"))).toEqual([
      expect.objectContaining({ task: "Current regenerated dinner prep.", mealIds: ["dinner"] }),
    ]);
    expect(current.prepTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "shared-prep",
          task: "Shared prep that still supports lunch.",
          mealIds: ["lunch"],
        }),
        expect.objectContaining({ id: "unrelated-lunch", mealIds: ["lunch"] }),
      ]),
    );
    expect(current.prepTasks.some((task) => task.task.includes("Old dinner"))).toBe(false);
    expect(current.prepTasks.some((task) => task.task.includes("Pre-existing duplicate"))).toBe(
      false,
    );
    expect(new Set(current.prepTasks.map((task) => task.id)).size).toBe(current.prepTasks.length);
  });

  it("preserves structured leftover links during individual regeneration", () => {
    const current = plan();
    current.meals[0] = {
      ...current.meals[0],
      mealDate: "2026-07-17",
      leftoverServings: 2,
    };
    current.meals[1] = {
      ...current.meals[1],
      dish: "Leftover grilled cheese",
      preparationBasis: "leftover",
      recipeId: "16161616-1616-4161-8161-161616161616",
      recipeTitle: "Grilled cheese",
      preparationMethod: null,
      ingredientRequirements: [],
      leftoverFromMealId: "lunch",
    };
    const replacement = weeklyPlanRefinementSchema.parse({
      summary: "Keep the structured leftovers.",
      replacementMeals: [
        {
          ...current.meals[1],
          leftoverFromMealId: null,
          preparationBasis: "leftover",
        },
      ],
      replacementShopping: [],
      replacementPrepTasks: [],
      warnings: [],
    });
    const merged = mergeRefinement(current, new Set(["dinner"]), replacement);
    expect(merged.meals[1]).toMatchObject({
      preparationBasis: "leftover",
      leftoverFromMealId: "lunch",
      recipeId: "16161616-1616-4161-8161-161616161616",
      recipeTitle: "Grilled cheese",
    });
  });

  it("routes a meal refinement to GPT-5.4, preserves other meals, and applies one stored alternative as a described revision", async () => {
    const { db, id } = await database();
    const replacement = meal("dinner", "dinner", "Thai prawn curry");
    state.responses.push(
      {
        value: {
          detectedLanguage: "English",
          wasTranslated: false,
          normalizedEnglish: "Use Thai flavors and keep lunch unchanged.",
        },
        usage: usage("gpt-5.4-mini"),
        sources: [],
      },
      {
        value: {
          summary: "Changed Saturday dinner to Thai prawn curry",
          replacementMeals: [replacement],
          replacementShopping: [],
          replacementPrepTasks: [],
          warnings: [],
        },
        usage: usage("gpt-5.4"),
        sources: [],
      },
    );
    const refined = await refineWeeklyPlan(actor, id, {
      scope: "meal",
      mealId: "dinner",
      mealDate: null,
      mealType: null,
      userId: null,
      instruction: "Use Thai flavors and keep lunch unchanged.",
      advanced: false,
    });
    expect(refined.revisionNumber).toBe(2);
    expect(state.calls.map((call) => call.modelTier)).toEqual(["economy", "primary"]);
    let current = (
      await db.query<{ payload: WeeklyPlan }>(
        "SELECT current_payload AS payload FROM weekly_plans WHERE id=$1",
        [id],
      )
    ).rows[0].payload;
    expect(current.meals.map((entry) => entry.dish)).toEqual([
      "Grilled cheese",
      "Thai prawn curry",
    ]);
    expect(current.shopping).toEqual([
      expect.objectContaining({ id: "shared-limes", mealIds: ["lunch"] }),
    ]);
    const alternatives = [
      meal("dinner", "dinner", "Greek lemon prawns"),
      meal("dinner", "dinner", "Prawn quesadillas"),
      meal("dinner", "dinner", "Prawn pasta"),
    ].map((option, index) => ({
      id: `option-${index + 1}`,
      meal: {
        ...option,
        recipeTitle: option.dish,
        recipeUrl: `https://example.com/recipe-${index + 1}`,
      },
      shopping: [],
      shoppingImpact: "No extra shopping.",
      leftoverImpact: "No downstream leftovers.",
      sourceEvidence: "Exact recipe page.",
    }));
    state.responses.push({
      value: { summary: "Three dinner alternatives", alternatives, recipeLinks: [], warnings: [] },
      usage: usage("gpt-5.4"),
      sources: alternatives.map((option) => ({
        url: option.meal.recipeUrl!,
        title: option.meal.recipeTitle,
      })),
    });
    const suggestion = await createWeeklyPlanSuggestion(actor, id, {
      kind: "alternatives",
      mealId: "dinner",
      instruction: "",
      advanced: false,
    });
    expect(suggestion.payload.alternatives).toHaveLength(3);
    const applied = await applyWeeklyPlanSuggestion(actor, id, suggestion.id, {
      optionId: "option-2",
    });
    expect(applied.revisionNumber).toBe(3);
    current = (
      await db.query<{ payload: WeeklyPlan }>(
        "SELECT current_payload AS payload FROM weekly_plans WHERE id=$1",
        [id],
      )
    ).rows[0].payload;
    expect(current.meals.map((entry) => entry.dish)).toEqual([
      "Grilled cheese",
      "Prawn quesadillas",
    ]);
    const revisions = await db.query<{ source: string; summary: string }>(
      "SELECT source,summary FROM weekly_plan_revisions ORDER BY revision_number",
    );
    expect(revisions.rows).toEqual([
      { source: "ai", summary: "Initial AI plan" },
      { source: "refinement", summary: "Changed Saturday dinner to Thai prawn curry" },
      { source: "alternative", summary: "Replaced Thai prawn curry with Prawn quesadillas" },
    ]);
    await db.close();
  }, 40_000);
  it("rebuilds alternative shopping previews from inventory instead of preserving model guesses", async () => {
    const { db, id } = await database();
    await db.query(
      `INSERT INTO inventory_entries (id,household_id,ingredient,category,quantity,unit,package_state,priority) VALUES ($1,$2,'Plain Greek yogurt','Dairy',1.5,'kg','opened','normal')`,
      [yogurtInventoryId, householdId],
    );
    const alternatives = ["Yogurt bowl", "Yogurt flatbread", "Yogurt dip plate"].map(
      (dish, index) => {
        const option = {
          ...meal("dinner", "dinner", dish),
          recipeTitle: dish,
          recipeUrl: `https://example.com/yogurt-${index + 1}`,
          ingredientRequirements: [
            {
              item: "Greek yogurt",
              category: "Dairy",
              quantity: 750,
              unit: "g",
              optional: false,
              inventoryEntryId: null,
            },
          ],
        };
        return {
          id: `option-${index + 1}`,
          meal: option,
          shopping: [
            {
              id: `model-yogurt-${index + 1}`,
              item: "Greek yogurt",
              category: "Dairy",
              quantity: 750,
              unit: "g",
              reason: "Model guessed zero inventory.",
              mealIds: ["dinner"],
              suggestedStore: null,
              saleItemId: null,
              estimatedPrice: null,
            },
          ],
          shoppingImpact: "Buy yogurt.",
          leftoverImpact: "No downstream leftovers.",
          sourceEvidence: "Exact recipe page.",
        };
      },
    );
    state.responses.push({
      value: { summary: "Three yogurt alternatives", alternatives, recipeLinks: [], warnings: [] },
      usage: usage("gpt-5.4"),
      sources: alternatives.map((option) => ({
        url: option.meal.recipeUrl!,
        title: option.meal.recipeTitle,
      })),
    });
    const suggestion = await createWeeklyPlanSuggestion(actor, id, {
      kind: "alternatives",
      mealId: "dinner",
      instruction: "",
      advanced: false,
    });
    expect(suggestion.payload.alternatives.every((option) => option.shopping.length === 0)).toBe(
      true,
    );
    expect(
      suggestion.payload.alternatives.every((option) =>
        option.meal.inventoryUses.some(
          (use) =>
            use.inventoryEntryId === yogurtInventoryId &&
            use.quantity === 0.75 &&
            use.unit === "kg",
        ),
      ),
    ).toBe(true);
    await db.close();
  }, 40_000);
  it("shows verified recipe ingredients and adds a previously omitted ingredient when the link is attached", async () => {
    const spanakopitaPlan = plan();
    spanakopitaPlan.meals[1].dish = "Spanakopita";
    spanakopitaPlan.shopping.push(
      {
        id: "shop-phyllo",
        item: "Phyllo pastry",
        category: "Frozen",
        quantity: 1,
        unit: "roll",
        reason: "Needed for spanakopita.",
        mealIds: ["dinner"],
        suggestedStore: null,
        saleItemId: null,
        estimatedPrice: null,
      },
      {
        id: "shop-spinach",
        item: "Spinach",
        category: "Vegetables",
        quantity: 500,
        unit: "g",
        reason: "Needed for spanakopita.",
        mealIds: ["dinner"],
        suggestedStore: null,
        saleItemId: null,
        estimatedPrice: null,
      },
      {
        id: "shop-feta",
        item: "Feta",
        category: "Dairy & Eggs",
        quantity: 200,
        unit: "g",
        reason: "Needed for spanakopita.",
        mealIds: ["dinner"],
        suggestedStore: null,
        saleItemId: null,
        estimatedPrice: null,
      },
    );
    const { db, id } = await database(spanakopitaPlan);
    const url = "https://example.com/spanakopita";
    state.responses.push({
      value: {
        summary: "Verified spanakopita recipe with ingredient-aware shopping.",
        alternatives: [],
        recipeLinks: [
          {
            id: "spanakopita-source",
            title: "Classic Spanakopita",
            url,
            domain: "example.com",
            matchStatus: "exact",
            prepMinutes: 45,
            yieldText: "12 pieces",
            evidenceSummary: "The page is an exact spanakopita recipe.",
            ingredients: [
              {
                item: "Phyllo pastry",
                category: "Frozen",
                quantity: 1,
                unit: "roll",
                optional: false,
              },
              {
                item: "Spinach",
                category: "Vegetables",
                quantity: 500,
                unit: "g",
                optional: false,
              },
              { item: "Feta", category: "Dairy & Eggs", quantity: 200, unit: "g", optional: false },
              {
                item: "Ricotta",
                category: "Dairy & Eggs",
                quantity: 250,
                unit: "g",
                optional: false,
              },
            ],
            shopping: [],
            shoppingImpact: "The model did not identify an additional purchase.",
            warnings: [],
          },
        ],
        warnings: [],
      },
      usage: usage("gpt-5.4"),
      sources: [{ url, title: "Classic Spanakopita" }],
    });
    const suggestion = await createWeeklyPlanSuggestion(actor, id, {
      kind: "recipe_link",
      mealId: "dinner",
      instruction: "",
      advanced: false,
    });
    expect(suggestion.payload.recipeLinks[0].ingredients).toContainEqual(
      expect.objectContaining({ item: "Ricotta", quantity: 250, unit: "g" }),
    );
    expect(suggestion.payload.recipeLinks[0].shopping).toEqual([
      expect.objectContaining({ item: "Ricotta", mealIds: ["dinner"] }),
    ]);
    const applied = await applyWeeklyPlanSuggestion(actor, id, suggestion.id, {
      optionId: "spanakopita-source",
    });
    expect(applied.revisionNumber).toBe(2);
    const current = (
      await db.query<{ payload: WeeklyPlan }>(
        "SELECT current_payload AS payload FROM weekly_plans WHERE id=$1",
        [id],
      )
    ).rows[0].payload;
    expect(current.meals.find((entry) => entry.id === "dinner")).toEqual(
      expect.objectContaining({ recipeTitle: "Classic Spanakopita", recipeUrl: url }),
    );
    expect(current.shopping).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "shared-limes", mealIds: ["lunch", "dinner"] }),
        expect.objectContaining({
          item: "Ricotta",
          category: "Dairy & Eggs",
          quantity: 250,
          unit: "g",
          mealIds: ["dinner"],
        }),
      ]),
    );
    const revision = (
      await db.query<{
        detail: {
          recipeIngredients: Array<{ item: string }>;
          recipeShopping: Array<{ item: string }>;
        };
      }>(
        "SELECT change_detail AS detail FROM weekly_plan_revisions WHERE revision_number=2 AND weekly_plan_id=$1",
        [id],
      )
    ).rows[0];
    expect(
      revision.detail.recipeIngredients.some((ingredient) => ingredient.item === "Ricotta"),
    ).toBe(true);
    expect(revision.detail.recipeShopping.some((line) => line.item === "Ricotta")).toBe(true);
    await db.close();
  }, 40_000);

  it("removes model shopping for ingredients covered by convertible or container inventory", async () => {
    const { db, id } = await database();
    await db.query(
      `INSERT INTO inventory_entries (id,household_id,ingredient,category,quantity,unit,package_state,priority) VALUES ($1,$3,'Plain Greek yogurt','Dairy',1.5,'kg','opened','normal'),($2,$3,'Tahini','Sauces',1,'jar','opened','normal')`,
      [yogurtInventoryId, tahiniInventoryId, householdId],
    );
    const url = "https://example.com/yogurt-tahini-sauce";
    const mistakenShopping = [
      {
        id: "model-yogurt",
        item: "Greek yogurt",
        category: "Dairy",
        quantity: 750,
        unit: "g",
        reason: "The model treated inventory as zero.",
        mealIds: ["dinner"],
        suggestedStore: null,
        saleItemId: null,
        estimatedPrice: null,
      },
      {
        id: "model-tahini",
        item: "Tahini",
        category: "Sauces",
        quantity: 2,
        unit: "tbsp",
        reason: "The model treated inventory as zero.",
        mealIds: ["dinner"],
        suggestedStore: null,
        saleItemId: null,
        estimatedPrice: null,
      },
    ];
    state.responses.push({
      value: {
        summary: "Verified sauce recipe.",
        alternatives: [],
        recipeLinks: [
          {
            id: "sauce-source",
            title: "Greek yogurt tahini sauce",
            url,
            domain: "example.com",
            matchStatus: "exact",
            prepMinutes: 10,
            yieldText: "2 servings",
            evidenceSummary: "The page is an exact recipe.",
            ingredients: [
              {
                item: "Greek yogurt",
                category: "Dairy",
                quantity: 750,
                unit: "g",
                optional: false,
              },
              { item: "Tahini", category: "Sauces", quantity: 2, unit: "tbsp", optional: false },
            ],
            shopping: mistakenShopping,
            shoppingImpact: "Buy both ingredients.",
            warnings: [],
          },
        ],
        warnings: [],
      },
      usage: usage("gpt-5.4"),
      sources: [{ url, title: "Greek yogurt tahini sauce" }],
    });
    const suggestion = await createWeeklyPlanSuggestion(actor, id, {
      kind: "recipe_link",
      mealId: "dinner",
      instruction: "",
      advanced: false,
    });
    expect(suggestion.payload.recipeLinks[0].shopping).toEqual([]);
    expect(suggestion.payload.recipeLinks[0].warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/Tahini.+1 jar.+2 tbsp/i)]),
    );
    await applyWeeklyPlanSuggestion(actor, id, suggestion.id, { optionId: "sauce-source" });
    const current = (
      await db.query<{ payload: WeeklyPlan }>(
        "SELECT current_payload AS payload FROM weekly_plans WHERE id=$1",
        [id],
      )
    ).rows[0].payload;
    expect(
      current.shopping.filter((line) => ["Greek yogurt", "Tahini"].includes(line.item)),
    ).toEqual([]);
    expect(current.meals.find((entry) => entry.id === "dinner")?.inventoryUses).toEqual(
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
    await db.close();
  }, 40_000);

  it("ignores refinement-authored shopping and rebuilds it from complete requirements", async () => {
    const { db, id } = await database();
    await db.query(
      `INSERT INTO inventory_entries (id,household_id,ingredient,category,quantity,unit,package_state,priority) VALUES ($1,$2,'Plain Greek yogurt','Dairy',1.5,'kg','opened','normal')`,
      [yogurtInventoryId, householdId],
    );
    const replacement = {
      ...meal("dinner", "dinner", "Greek yogurt bowl"),
      ingredientRequirements: [
        {
          item: "Greek yogurt",
          category: "Dairy",
          quantity: 750,
          unit: "g",
          optional: false,
          inventoryEntryId: null,
        },
      ],
    };
    state.responses.push(
      {
        value: {
          detectedLanguage: "English",
          wasTranslated: false,
          normalizedEnglish: "Use the yogurt already in inventory.",
        },
        usage: usage("gpt-5.4-mini"),
        sources: [],
      },
      {
        value: {
          summary: "Use inventory yogurt.",
          replacementMeals: [replacement],
          replacementShopping: [
            {
              id: "model-yogurt",
              item: "Greek yogurt",
              category: "Dairy",
              quantity: 750,
              unit: "g",
              reason: "Model-authored shopping.",
              mealIds: ["dinner"],
              suggestedStore: null,
              saleItemId: null,
              estimatedPrice: null,
            },
          ],
          replacementPrepTasks: [],
          warnings: [],
        },
        usage: usage("gpt-5.4"),
        sources: [],
      },
    );
    await refineWeeklyPlan(actor, id, {
      scope: "meal",
      mealId: "dinner",
      mealDate: null,
      mealType: null,
      userId: null,
      instruction: "Use the yogurt already in inventory.",
      advanced: false,
    });
    const current = (
      await db.query<{ payload: WeeklyPlan }>(
        "SELECT current_payload AS payload FROM weekly_plans WHERE id=$1",
        [id],
      )
    ).rows[0].payload;
    expect(current.shopping.filter((line) => line.item === "Greek yogurt")).toEqual([]);
    expect(current.meals.find((entry) => entry.id === "dinner")?.inventoryUses).toContainEqual({
      inventoryEntryId: yogurtInventoryId,
      ingredient: "Greek yogurt",
      quantity: 0.75,
      unit: "kg",
    });
    await db.close();
  }, 40_000);

  it("bounds combined draft and refinement warnings before saving the revision", async () => {
    const original = plan();
    original.warnings = Array.from({ length: 30 }, (_, index) => `Existing warning ${index + 1}.`);
    const { db, id } = await database(original);
    const replacement = meal("dinner", "dinner", "Thai prawn curry");
    state.responses.push(
      {
        value: {
          detectedLanguage: "English",
          wasTranslated: false,
          normalizedEnglish: "Use Thai flavors.",
        },
        usage: usage("gpt-5.4-mini"),
        sources: [],
      },
      {
        value: {
          summary: "Changed dinner.",
          replacementMeals: [replacement],
          replacementShopping: [],
          replacementPrepTasks: [],
          warnings: Array.from({ length: 20 }, (_, index) => `Refinement warning ${index + 1}.`),
        },
        usage: usage("gpt-5.4"),
        sources: [],
      },
    );
    await refineWeeklyPlan(actor, id, {
      scope: "meal",
      mealId: "dinner",
      mealDate: null,
      mealType: null,
      userId: null,
      instruction: "Use Thai flavors.",
      advanced: false,
    });
    const current = (
      await db.query<{ payload: WeeklyPlan }>(
        "SELECT current_payload AS payload FROM weekly_plans WHERE id=$1",
        [id],
      )
    ).rows[0].payload;
    expect(current.warnings).toHaveLength(30);
    expect(current.warnings.slice(0, 2)).toEqual([
      "Refinement warning 1.",
      "Refinement warning 2.",
    ]);
    expect(current.warnings.at(-1)).toMatch(
      /Additional planner warnings omitted: 21 additional distinct warnings were condensed/i,
    );
    await db.close();
  }, 40_000);

  it("recovers a truncated refinement once and retains the failed response diagnostics", async () => {
    const { db, id } = await database();
    const replacement = meal("dinner", "dinner", "Thai prawn curry");
    const { inventoryUses: discardedInventoryUses, ...compactReplacement } = replacement;
    void discardedInventoryUses;
    state.responses.push(
      {
        value: {
          detectedLanguage: "English",
          wasTranslated: false,
          normalizedEnglish: "Use Thai flavors.",
        },
        usage: usage("gpt-5.4-mini"),
        sources: [],
      },
      maxOutputError("response-truncated-refinement", 24_000, 3_500),
      {
        value: {
          summary: "Changed dinner to Thai prawn curry.",
          replacementMeals: [compactReplacement],
          replacementPrepTasks: [],
          warnings: [],
        },
        usage: usage("gpt-5.4"),
        sources: [],
      },
    );
    const refined = await refineWeeklyPlan(actor, id, {
      scope: "meal",
      mealId: "dinner",
      mealDate: null,
      mealType: null,
      userId: null,
      instruction: "Use Thai flavors.",
      advanced: false,
    });
    expect(refined.revisionNumber).toBe(2);
    expect(state.calls.slice(1).map((call) => call.maxOutputTokens)).toEqual([24_000, 32_000]);
    expect(state.calls[2].instructions).toMatch(/previous attempt reached its output-token limit/i);
    const runs = await db.query<{
      status: string;
      responseId: string | null;
      outputTokens: number | null;
      promptVersion: string;
    }>(
      `SELECT status,response_id AS "responseId",output_tokens AS "outputTokens",prompt_version AS "promptVersion" FROM ai_runs WHERE prompt_version LIKE 'weekly-refinement-v3-%' ORDER BY created_at`,
    );
    expect(runs.rows).toEqual([
      expect.objectContaining({
        status: "failed",
        responseId: "response-truncated-refinement",
        outputTokens: 24_000,
        promptVersion: "weekly-refinement-v3-compact-recovery",
      }),
      expect.objectContaining({
        status: "completed",
        promptVersion: "weekly-refinement-v3-compact-recovery-max-output-recovery",
      }),
    ]);
    await db.close();
  }, 40_000);

  it("recovers truncated advanced recipe discovery with the larger compact ceiling", async () => {
    const { db, id } = await database();
    const url = "https://example.com/prawn-tacos";
    state.responses.push(maxOutputError("response-truncated-recipe", 32_000, 4_200), {
      value: {
        summary: "Found an exact recipe.",
        alternatives: [],
        recipeLinks: [
          {
            id: "prawn-tacos-source",
            title: "Prawn tacos",
            url,
            matchStatus: "exact",
            prepMinutes: 30,
            yieldText: "2 servings",
            evidenceSummary: "The page is an exact recipe for the planned dish.",
            ingredients: [
              { item: "Prawns", category: "Seafood", quantity: 400, unit: "g", optional: false },
            ],
            warnings: [],
          },
        ],
        warnings: [],
      },
      usage: usage("gpt-5.6-terra"),
      sources: [{ url, title: "Prawn tacos" }],
    });
    const suggestion = await createWeeklyPlanSuggestion(actor, id, {
      kind: "recipe_link",
      mealId: "dinner",
      instruction: "",
      advanced: true,
    });
    expect(suggestion.payload.recipeLinks).toHaveLength(1);
    expect(state.calls.map((call) => call.maxOutputTokens)).toEqual([32_000, 48_000]);
    expect(state.calls.map((call) => call.modelTier)).toEqual(["fallback", "fallback"]);
    const runs = await db.query<{
      status: string;
      responseId: string | null;
      outputTokens: number | null;
      promptVersion: string;
    }>(
      `SELECT status,response_id AS "responseId",output_tokens AS "outputTokens",prompt_version AS "promptVersion" FROM ai_runs WHERE prompt_version LIKE 'weekly-suggestion-v3-%' ORDER BY created_at`,
    );
    expect(runs.rows).toEqual([
      expect.objectContaining({
        status: "failed",
        responseId: "response-truncated-recipe",
        outputTokens: 32_000,
        promptVersion: "weekly-suggestion-v3-compact-recovery",
      }),
      expect.objectContaining({
        status: "completed",
        promptVersion: "weekly-suggestion-v3-compact-recovery-max-output-recovery",
      }),
    ]);
    await db.close();
  }, 40_000);
});
