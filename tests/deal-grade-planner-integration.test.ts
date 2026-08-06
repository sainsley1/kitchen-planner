import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getPool: () => state.pool, poolOrThrow: () => state.pool }));

import { planningContext } from "@/lib/ai/context";

const householdId = "33333333-3333-4333-8333-333333333333";

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
    "0017_price_history_and_deal_scoring",
  ])
    await database.exec(await fs.readFile(`drizzle/${name}.sql`, "utf8"));

  const client = {
    query: (text: string, values?: unknown[]) => database.query(text, values),
    release: () => undefined,
  };
  state.pool = { connect: async () => client, query: client.query };

  await database.query("INSERT INTO households (id,name) VALUES ($1,'Kitchen')", [householdId]);
  return database;
}

describe("Deal Grade & Flavor Asset Planner Integration", () => {
  it("ranks A+ deals higher and penalizes F fake deals", async () => {
    const db = await createDatabase();

    const flyerRes = await db.query<{ id: string }>(
      `INSERT INTO flyer_sources (household_id, store_name, source_type, valid_from, valid_until, status)
       VALUES ($1, 'Whole Foods', 'image', '2026-08-01', '2026-08-07', 'committed')
       RETURNING id`,
      [householdId],
    );
    const flyerId = flyerRes.rows[0].id;

    // Insert 3 sales: A+ Steal Salmon, F Fake Deal Steak, and Normal Chicken
    await db.query(
      `INSERT INTO flyer_sale_items 
       (flyer_source_id, household_id, item, price, regular_price, status, deal_grade, normalized_unit_price, normalized_unit_measure)
       VALUES 
       ($1, $2, 'Atlantic Salmon', 4.99, 9.99, 'accepted', 'A+', 4.99, 'lb'),
       ($1, $2, 'Ribeye Steak', 19.99, 29.99, 'accepted', 'F', 19.99, 'lb'),
       ($1, $2, 'Chicken Breast', 2.99, 3.49, 'accepted', 'B', 2.99, 'lb')`,
      [flyerId, householdId],
    );

    // Insert flavor asset recipe with garlic and ginger
    await db.query(
      `INSERT INTO recipes (household_id, title, source_type, ingredients, tags)
       VALUES ($1, 'Garlic Ginger Salmon', 'household', '[{"item":"salmon"}]'::jsonb, ARRAY['flavor_asset:garlic', 'flavor_asset:ginger'])`,
      [householdId],
    );

    // Patch global pool getter via query testing
    const context = await planningContext(householdId, "2026-08-01", "2026-08-07");

    expect(context.activeSales.length).toBe(3);

    const salmon = context.activeSales.find((s) => s.item === "Atlantic Salmon");
    const steak = context.activeSales.find((s) => s.item === "Ribeye Steak");

    expect(salmon?.dealGrade).toBe("A+");
    expect(steak?.dealGrade).toBe("F");

    // Salmon (A+) should have a significantly higher opportunity score than Steak (F)
    expect(salmon!.opportunityScore).toBeGreaterThan(steak!.opportunityScore + 50);

    // Opportunity reasons should reflect A+ steal and normalized rate
    expect(salmon?.opportunityReasons).toContain("🔥 A+ all-time low steal");
    expect(salmon?.opportunityReasons).toContain("$4.99 / lb");

    expect(steak?.opportunityReasons).toContain("⚠️ F grade artificially inflated baseline");

    await db.close();
  }, 40_000);
});
