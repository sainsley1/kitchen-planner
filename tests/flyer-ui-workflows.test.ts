import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const householdId = "22222222-2222-4222-8222-222222222222";

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

  await database.query("INSERT INTO households (id,name) VALUES ($1,'Kitchen')", [householdId]);
  return database;
}

describe("Flyer UI & Batch Decision Workflows", () => {
  it("filters low confidence items for batch rejection", async () => {
    const db = await createDatabase();

    const flyerRes = await db.query<{ id: string }>(
      `INSERT INTO flyer_sources (household_id, store_name, source_type, valid_from, valid_until, status)
       VALUES ($1, 'Safeway', 'image', '2026-08-01', '2026-08-07', 'review')
       RETURNING id`,
      [householdId],
    );
    const flyerId = flyerRes.rows[0].id;

    await db.query(
      `INSERT INTO flyer_sale_items (flyer_source_id, household_id, item, price, confidence, status, deal_grade, normalized_unit_price, normalized_unit_measure)
       VALUES 
       ($1, $2, 'Butter', 2.99, 0.90, 'proposed', 'A', 2.99, 'lb'),
       ($1, $2, 'Mysterious Item', 1.99, 0.45, 'proposed', 'C', 1.99, 'each')`,
      [flyerId, householdId],
    );

    const items = await db.query<{ id: string; confidence: string; status: string }>(
      `SELECT id, confidence, status FROM flyer_sale_items WHERE flyer_source_id = $1`,
      [flyerId],
    );

    const lowConfidence = items.rows.filter(
      (item) => item.status === "proposed" && Number(item.confidence) < 0.6,
    );

    expect(lowConfidence.length).toBe(1);
    expect(lowConfidence[0].confidence).toBe("0.450");

    await db.close();
  }, 40_000);
});
