import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("append-only PostgreSQL migrations", () => {
  it("applies all released schemas in filename order", async () => {
    const database = new PGlite();
    const initial = await fs.readFile("drizzle/0000_initial.sql", "utf8");
    const phase3 = await fs.readFile("drizzle/0001_phase3_persistence.sql", "utf8");
    const phase4 = await fs.readFile("drizzle/0002_phase4_cutover.sql", "utf8");
    const workflows = await fs.readFile("drizzle/0003_meal_and_shopping_workflows.sql", "utf8");
    const settings = await fs.readFile("drizzle/0004_settings_and_shopping_cleanup.sql", "utf8");
    const ai = await fs.readFile("drizzle/0005_ai_foundation.sql", "utf8");
    const fallback = await fs.readFile("drizzle/0006_model_fallback.sql", "utf8");
    const economy = await fs.readFile("drizzle/0007_economy_model_tier.sql", "utf8");
    const weeklyPlanning = await fs.readFile("drizzle/0008_weekly_planning.sql", "utf8");
    const asyncWeeklyPlanning = await fs.readFile("drizzle/0009_async_weekly_planning.sql", "utf8");
    const recipeDiscovery = await fs.readFile("drizzle/0010_recipe_discovery.sql", "utf8");
    const weeklyRefinement = await fs.readFile("drizzle/0011_weekly_refinement.sql", "utf8");
    const recipesAndFlyers = await fs.readFile(
      "drizzle/0012_recipe_library_and_flyers.sql",
      "utf8",
    );
    const planningCostModes = await fs.readFile("drizzle/0013_planning_cost_modes.sql", "utf8");
    const weeklyPlanArchival = await fs.readFile("drizzle/0014_weekly_plan_archival.sql", "utf8");
    const planningOpportunities = await fs.readFile(
      "drizzle/0015_planning_opportunities_and_inventory_review.sql",
      "utf8",
    );
    const multibuyFlyerPrices = await fs.readFile(
      "drizzle/0016_multibuy_flyer_price_integrity.sql",
      "utf8",
    );
    const priceHistory = await fs.readFile(
      "drizzle/0017_price_history_and_deal_scoring.sql",
      "utf8",
    );
    await database.exec(initial);
    await database.exec(phase3);
    await database.exec(phase4);
    await database.exec(workflows);
    await database.exec(settings);
    await database.exec(ai);
    await database.exec(fallback);
    await database.exec(economy);
    await database.exec(weeklyPlanning);
    await database.exec(asyncWeeklyPlanning);
    await database.exec(recipeDiscovery);
    await database.exec(weeklyRefinement);
    await database.exec(recipesAndFlyers);
    await database.exec(planningCostModes);
    await database.exec(weeklyPlanArchival);
    await database.exec(planningOpportunities);
    await database.exec(multibuyFlyerPrices);
    await database.exec(priceHistory);
    const result = await database.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
    );
    const tables = new Set(result.rows.map((row) => row.table_name));
    expect(tables.has("inventory_entries")).toBe(true);
    expect(tables.has("audit_events")).toBe(true);
    expect(tables.has("app_sessions")).toBe(true);
    expect(tables.has("unscheduled_items")).toBe(true);
    expect(tables.has("cutover_runs")).toBe(true);
    expect(tables.has("ai_jobs")).toBe(true);
    expect(tables.has("ai_runs")).toBe(true);
    expect(tables.has("ai_proposals")).toBe(true);
    expect(tables.has("weekly_plans")).toBe(true);
    expect(tables.has("weekly_plan_revisions")).toBe(true);
    expect(tables.has("weekly_plan_recipe_sources")).toBe(true);
    expect(tables.has("weekly_plan_suggestions")).toBe(true);
    expect(tables.has("flyer_sources")).toBe(true);
    expect(tables.has("flyer_sale_items")).toBe(true);
    expect(tables.has("meal_day_inventory_reviews")).toBe(true);
    const weeklyColumns = await database.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='weekly_plans'",
    );
    expect(weeklyColumns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        "include_snacks",
        "include_desserts",
        "discover_recipes",
        "archived_at",
      ]),
    );
    const mealColumns = await database.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='meal_plan_entries'",
    );
    expect(mealColumns.rows.map((row) => row.column_name)).toContain("archived_at");
    expect(mealColumns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining(["weekly_plan_id", "weekly_plan_meal_id", "planned_inventory_uses"]),
    );
    const flyerSaleColumns = await database.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='flyer_sale_items'",
    );
    expect(flyerSaleColumns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        "category",
        "regular_price",
        "savings_amount",
        "discount_percent",
        "prioritized",
      ]),
    );
    const unscheduledColumns = await database.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='unscheduled_items'",
    );
    expect(unscheduledColumns.rows.map((row) => row.column_name)).toContain(
      "source_meal_plan_entry_id",
    );
    const shoppingColumns = await database.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='shopping_items'",
    );
    expect(shoppingColumns.rows.map((row) => row.column_name)).not.toContain("preferred_store");
    expect(shoppingColumns.rows.map((row) => row.column_name)).not.toContain("priority");
    expect(shoppingColumns.rows.map((row) => row.column_name)).toContain("weekly_plan_id");
    const importColumns = await database.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='import_batches'",
    );
    expect(importColumns.rows.map((row) => row.column_name)).toContain("archived_at");
    const jobColumns = await database.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='ai_jobs'",
    );
    expect(jobColumns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining(["retry_of_job_id", "fallback_reason"]),
    );
    const runColumns = await database.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='ai_runs'",
    );
    expect(runColumns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        "model_tier",
        "trigger_reason",
        "web_search_calls",
        "web_source_count",
      ]),
    );
    const revisionColumns = await database.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='weekly_plan_revisions'",
    );
    expect(revisionColumns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining(["summary", "change_detail"]),
    );
    const recipeColumns = await database.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='recipes'",
    );
    expect(recipeColumns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        "ingredients",
        "instructions",
        "favorite",
        "recipe_status",
        "archived_at",
      ]),
    );
    const tierConstraint = await database.query<{ definition: string }>(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='ai_runs_model_tier_check'",
    );
    expect(tierConstraint.rows[0].definition).toContain("economy");
    expect(tierConstraint.rows[0].definition).toContain("balanced");
    expect(tierConstraint.rows[0].definition).toContain("planning");
    const activePlanningIndex = await database.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE indexname='ai_jobs_one_active_weekly_plan_per_household_idx'",
    );
    expect(activePlanningIndex.rows).toHaveLength(1);
    const flyerPriceConstraint = await database.query<{ definition: string }>(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='flyer_sale_regular_price_check'",
    );
    expect(flyerPriceConstraint.rows[0].definition).toContain("multi_buy_quantity");
    await database.close();
  }, 40_000);

  it("preserves legacy queued weekly jobs as deep plans during the cost-mode migration", async () => {
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
    ])
      await database.exec(await fs.readFile(`drizzle/${migration}.sql`, "utf8"));
    const household = (
      await database.query<{ id: string }>(
        "INSERT INTO households (name) VALUES ('Kitchen') RETURNING id",
      )
    ).rows[0];
    const user = (
      await database.query<{ id: string }>(
        "INSERT INTO household_users (household_id,display_name,role) VALUES ($1,'Alex','owner') RETURNING id",
        [household.id],
      )
    ).rows[0];
    const snapshot = {
      jobKind: "weekly_plan_generation",
      stage: "queued",
      request: {
        startDate: "2026-07-18",
        endDate: "2026-07-24",
        startMeal: "lunch",
        endMeal: "breakfast",
      },
    };
    const job = (
      await database.query<{ id: string }>(
        "INSERT INTO ai_jobs (household_id,actor_user_id,workflow,status,input_snapshot) VALUES ($1,$2,'weekly_planning','queued',$3::jsonb) RETURNING id",
        [household.id, user.id, JSON.stringify(snapshot)],
      )
    ).rows[0];
    await database.exec(await fs.readFile("drizzle/0013_planning_cost_modes.sql", "utf8"));
    const result = await database.query<{ planningMode: string }>(
      `SELECT input_snapshot#>>'{request,planningMode}' AS "planningMode" FROM ai_jobs WHERE id=$1`,
      [job.id],
    );
    expect(result.rows[0].planningMode).toBe("deep");
    await database.close();
  }, 20_000);

  it("backfills already-resolved meal days and returns their deferred entries", async () => {
    const database = new PGlite();
    for (const migration of [
      "drizzle/0000_initial.sql",
      "drizzle/0001_phase3_persistence.sql",
      "drizzle/0002_phase4_cutover.sql",
    ])
      await database.exec(await fs.readFile(migration, "utf8"));
    const household = (
      await database.query<{ id: string }>(
        "INSERT INTO households (name) VALUES ('Kitchen') RETURNING id",
      )
    ).rows[0];
    await database.query(
      `INSERT INTO meal_plan_entries (household_id,meal_date,meal_type,dish,status,notes)
       VALUES ($1,current_date-1,'lunch','Deferred soup','deferred','Keep this'),
              ($1,current_date-1,'dinner','Finished pasta','completed',NULL)`,
      [household.id],
    );

    await database.exec(await fs.readFile("drizzle/0003_meal_and_shopping_workflows.sql", "utf8"));
    const archived = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM meal_plan_entries WHERE archived_at IS NOT NULL",
    );
    expect(archived.rows[0].count).toBe(2);
    const returned = await database.query<{ title: string; status: string; notes: string }>(
      "SELECT title,status,notes FROM unscheduled_items",
    );
    expect(returned.rows).toHaveLength(1);
    expect(returned.rows[0]).toMatchObject({ title: "Deferred soup", status: "planned" });
    expect(returned.rows[0].notes).toContain("Deferred from archived meal plan");
    const audits = await database.query<{ action: string; source: string }>(
      "SELECT action,source FROM audit_events",
    );
    expect(audits.rows.filter((entry) => entry.action === "archive")).toHaveLength(2);
    expect(audits.rows.every((entry) => entry.source === "system")).toBe(true);
    await database.close();
  }, 20_000);
});
