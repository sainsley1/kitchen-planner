import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { weeklyPlanSchema, type WeeklyPlan, type WeeklyPlanRequest } from "../lib/ai/contracts";

const state = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getPool: () => state.pool, poolOrThrow: () => state.pool }));
vi.mock("@/lib/config", () => ({
  appConfig: {
    aiConfigured: false,
    models: { economy: "mini", routine: "routine", fallback: "fallback", planning: "planning" },
    planningReasoningEffort: "high",
    planningTimeoutMs: 1_800_000,
  },
}));
import { planningContext } from "../lib/ai/context";
import { validateWeeklyPlan } from "../lib/services/weekly-planning";
import { archiveExpiredFlyers, createFlyerSale } from "../lib/services/flyers";

const householdId = "22222222-2222-4222-8222-222222222222";
const userId = "99999999-9999-4999-8999-999999999999";
const recipeId = "77777777-7777-4777-8777-777777777777";
const flyerId = "66666666-6666-4666-8666-666666666666";
const saleId = "55555555-5555-4555-8555-555555555555";
const constrainedSaleId = "22222222-3333-4333-8333-222222222222";
const flavorId = "44444444-4444-4444-8444-444444444444";

async function database() {
  const db = new PGlite();
  const names = (await fs.readdir("drizzle")).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort();
  for (const name of names) await db.exec(await fs.readFile(`drizzle/${name}`, "utf8"));
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
    "INSERT INTO household_users (id,household_id,display_name,role) VALUES ($1,$2,'Alex','owner')",
    [userId, householdId],
  );
  await db.query(
    "INSERT INTO food_preferences (household_id,topic,classification,detail,status) VALUES ($1,'Mushrooms','hard_constraint','Do not serve mushrooms','active')",
    [householdId],
  );
  await db.query(
    `INSERT INTO recipes (id,household_id,title,source_type,cuisine,planned_yield,ingredients,favorite,recipe_status,created_by) VALUES ($1,$2,'Paneer masala','household','Indian','4 servings',$3::jsonb,true,'proven',$4)`,
    [
      recipeId,
      householdId,
      JSON.stringify([
        {
          item: "Paneer",
          quantity: 400,
          unit: "g",
          preparation: null,
          optional: false,
          notes: null,
        },
      ]),
      userId,
    ],
  );
  await db.query(
    `INSERT INTO inventory_entries (id,household_id,ingredient,category,quantity,unit,package_state,priority) VALUES ($1,$2,'Gochujang','Sauces',1,'tub','opened','normal')`,
    [flavorId, householdId],
  );
  await db.query(
    `INSERT INTO meal_plan_entries (household_id,meal_date,meal_type,dish,status) VALUES ($1,'2026-07-10','dinner','Paneer masala','completed')`,
    [householdId],
  );
  await db.query(
    `INSERT INTO flyer_sources (id,household_id,store_name,valid_from,valid_until,source_type,status,created_by,committed_by,committed_at) VALUES ($1,$2,'Sabzi Mandi','2026-07-17','2026-07-24','manual','committed',$3,$3,now())`,
    [flyerId, householdId, userId],
  );
  await db.query(
    `INSERT INTO flyer_sale_items (id,flyer_source_id,household_id,item,category,price,regular_price,savings_amount,discount_percent,pricing_unit,status,prioritized) VALUES ($1,$3,$4,'Cauliflower','Produce',2.49,4.99,2.50,50.10,'each','accepted',true),($2,$3,$4,'Mushrooms','Produce',1.99,4.99,3.00,60.12,'pack','accepted',false)`,
    [saleId, constrainedSaleId, flyerId, householdId],
  );
  return db;
}
function plan(id: string): WeeklyPlan {
  return weeklyPlanSchema.parse({
    title: "Saved recipe and sale",
    summary: "Uses reviewed evidence.",
    strategy: "Use the household recipe with a suitable sale.",
    meals: [
      {
        id: "dinner",
        mealDate: "2026-07-18",
        mealType: "dinner",
        assignedUserId: null,
        dish: "Paneer masala",
        cuisine: "Indian",
        recipeId,
        recipeTitle: "Paneer masala",
        recipeUrl: null,
        servings: 2,
        leftoverServings: 0,
        leftoverFromMealId: null,
        packedLunch: false,
        workplaceMeal: false,
        workplaceFriendly: true,
        intensity: "substantial",
        prepMinutes: 60,
        plannedYield: "4 servings",
        rationale: "A saved household favourite.",
        notes: null,
        unscheduledItemId: null,
        inventoryUses: [],
      },
    ],
    coverageExceptions: [],
    shopping: [
      {
        id: "cauliflower",
        item: "Cauliflower",
        category: "Produce",
        quantity: 1,
        unit: "each",
        reason: "Roasted side.",
        mealIds: ["dinner"],
        suggestedStore: "Sabzi Mandi",
        saleItemId: id,
        estimatedPrice: 2.49,
      },
    ],
    prepTasks: [],
    warnings: [],
  });
}

describe("recipe and flyer planning evidence", () => {
  beforeEach(() => {
    state.pool = null;
  });
  it("supplies recent meals, flavour assets and ranked reviewed sales while rejecting invented sale references", async () => {
    const db = await database();
    const context = await planningContext(householdId, "2026-07-18", "2026-07-19");
    expect(context.recipes).toEqual([
      expect.objectContaining({ id: recipeId, title: "Paneer masala", favorite: true }),
    ]);
    expect(context.recentMeals).toEqual([
      expect.objectContaining({ dish: "Paneer masala", mealDate: "2026-07-10" }),
    ]);
    expect(context.flavorAssets).toEqual([
      expect.objectContaining({ id: flavorId, ingredient: "Gochujang" }),
    ]);
    expect(context.activeSales[0]).toEqual(
      expect.objectContaining({
        id: saleId,
        storeName: "Sabzi Mandi",
        price: "2.49",
        regularPrice: "4.99",
        prioritized: true,
        opportunityScore: expect.any(Number),
        opportunityReasons: expect.arrayContaining([
          "household priority",
          "flavour assets available for pairing",
        ]),
      }),
    );
    expect(context.activeSales.find((sale) => sale.id === constrainedSaleId)).toEqual(
      expect.objectContaining({
        opportunityReasons: expect.arrayContaining(["potential household-constraint conflict"]),
      }),
    );
    expect(context.activeSales[0].opportunityScore).toBeGreaterThan(
      context.activeSales[1].opportunityScore,
    );
    expect(context.saleOpportunitySummary).toEqual({
      eligibleCount: 2,
      suppliedCount: 2,
      priorityCount: 1,
    });
    const request: WeeklyPlanRequest = {
      startDate: "2026-07-18",
      endDate: "2026-07-18",
      startMeal: "dinner",
      endMeal: "dinner",
      planningMode: "balanced",
      notes: "",
      includeSnacks: false,
      includeDesserts: false,
      discoverRecipes: false,
    };
    expect(validateWeeklyPlan(plan(saleId), request, context)).toEqual([]);
    const issues = validateWeeklyPlan(
      plan("33333333-3333-4333-8333-333333333333"),
      request,
      context,
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown_flyer_sale", severity: "error" }),
      ]),
    );
    await db.close();
  }, 30_000);

  it("archives every expired flyer in one audited action while retaining current sales", async () => {
    const db = await database();
    const currentId = "33333333-3333-4333-8333-333333333333";
    await db.query(
      `INSERT INTO flyer_sources (id,household_id,store_name,valid_from,valid_until,source_type,status,created_by,committed_by,committed_at) VALUES ($1,$2,'Future Market','2099-07-17','2099-07-24','manual','committed',$3,$3,now())`,
      [currentId, householdId, userId],
    );
    const actor = { householdId, userId, displayName: "Alex", role: "owner" as const };
    expect(await archiveExpiredFlyers(actor)).toMatchObject({ count: 1, ids: [flyerId] });
    expect(await archiveExpiredFlyers(actor)).toEqual({ count: 0, ids: [] });
    const flyers = await db.query<{ id: string; archivedAt: string | null }>(
      'SELECT id,archived_at::text AS "archivedAt" FROM flyer_sources ORDER BY id',
    );
    expect(flyers.rows.find((entry) => entry.id === flyerId)?.archivedAt).not.toBeNull();
    expect(flyers.rows.find((entry) => entry.id === currentId)?.archivedAt).toBeNull();
    const audit = await db.query<{ action: string; reason: string }>(
      "SELECT action,reason FROM audit_events WHERE entity_type='flyer_source' AND entity_id=$1",
      [flyerId],
    );
    expect(audit.rows).toEqual([
      expect.objectContaining({
        action: "bulk_archive",
        reason: expect.stringMatching(/expired Sabzi Mandi/i),
      }),
    ]);
    await db.close();
  }, 30_000);

  it("stores multi-buy totals with per-item regular-price calculations", async () => {
    const db = await database();
    const actor = { householdId, userId, displayName: "Alex", role: "owner" as const };
    const created = await createFlyerSale(actor, flyerId, {
      item: "Shanghai bok choy",
      brand: null,
      category: "Produce",
      packageSize: "1 lb",
      price: 6,
      regularPrice: 3.99,
      savingsAmount: null,
      discountPercent: null,
      pricingUnit: "bundle",
      multiBuyQuantity: 2,
      memberOnly: false,
      limitText: null,
      notes: null,
      confidence: 0.96,
      evidenceText: "2 for $6; regular $3.99 each",
      sourceReference: "Page 3",
      status: "proposed",
      prioritized: false,
    });
    const saved = await db.query<{
      price: string;
      regularPrice: string;
      savingsAmount: string;
      discountPercent: string;
      multiBuyQuantity: number;
    }>(
      `SELECT price::text,regular_price::text AS "regularPrice",savings_amount::text AS "savingsAmount",discount_percent::text AS "discountPercent",multi_buy_quantity AS "multiBuyQuantity" FROM flyer_sale_items WHERE id=$1`,
      [created.id],
    );
    expect(saved.rows[0]).toEqual({
      price: "6.00",
      regularPrice: "3.99",
      savingsAmount: "0.99",
      discountPercent: "24.81",
      multiBuyQuantity: 2,
    });
    await db.close();
  }, 30_000);
});
