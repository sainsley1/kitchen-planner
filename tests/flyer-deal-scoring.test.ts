import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { calculateDealGrade, normalizeUnitPrice } from "../lib/flyers/price-intelligence";

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

describe("Flyer price intelligence & deal scoring", () => {
  describe("Unit price normalization", () => {
    it("normalizes package sizes to standard rates ($/lb, $/kg, $/each)", () => {
      expect(normalizeUnitPrice(3.99, "1.5 lb", "each", 1)).toEqual({
        unitPrice: 2.66,
        unitMeasure: "lb",
      });

      expect(normalizeUnitPrice(2.49, "12 oz", "each", 1)).toEqual({
        unitPrice: 3.32,
        unitMeasure: "lb",
      });

      expect(normalizeUnitPrice(4.99, "500 g", "each", 1)).toEqual({
        unitPrice: 9.98,
        unitMeasure: "kg",
      });

      expect(normalizeUnitPrice(4.99, "500 gm", "each", 1)).toEqual({
        unitPrice: 9.98,
        unitMeasure: "kg",
      });

      expect(normalizeUnitPrice(2.5, "250 gms", "each", 1)).toEqual({
        unitPrice: 10.0,
        unitMeasure: "kg",
      });

      expect(normalizeUnitPrice(6.0, "6 count", "pack", 1)).toEqual({
        unitPrice: 1.0,
        unitMeasure: "each",
      });
    });
  });

  describe("Deal grade calculation", () => {
    it("assigns A+ for discounts >= 35%", () => {
      const result = calculateDealGrade(1.99, 3.99, null);
      expect(result.dealGrade).toBe("A+");
      expect(result.estimatedRegularPrice).toBe(3.99);
    });

    it("assigns A for discounts >= 25%", () => {
      const result = calculateDealGrade(2.99, 3.99, null);
      expect(result.dealGrade).toBe("A");
    });

    it("assigns B for discounts >= 15%", () => {
      const result = calculateDealGrade(3.29, 3.99, null);
      expect(result.dealGrade).toBe("B");
    });

    it("assigns F for artificial baseline inflation (>30% above historical average)", () => {
      // Printed regular price is $7.99, but historical average is $4.99
      const result = calculateDealGrade(4.99, 7.99, 4.99);
      expect(result.dealGrade).toBe("F");
      expect(result.estimatedRegularPrice).toBe(4.99);
    });
  });

  describe("Database schema migration 0017", () => {
    it("executes migration 0017 and verifies price history table", async () => {
      const db = await createDatabase();
      const res = await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'flyer_sale_items' AND column_name = 'deal_grade'",
      );
      expect(res.rows.length).toBe(1);
      await db.close();
    }, 40_000);
  });
});
