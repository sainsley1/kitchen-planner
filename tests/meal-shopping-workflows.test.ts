import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getPool: () => state.pool }));

import {
  registerGroceryShop,
  resolveMealInventoryReview,
  scheduleUnscheduled,
  updateMeal,
} from "../lib/services/mutations";

async function applyAllMigrations(database: PGlite) {
  const names = (await fs.readdir("drizzle")).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort();
  for (const name of names) await database.exec(await fs.readFile(`drizzle/${name}`, "utf8"));
}

describe("meal archival and grocery registration", () => {
  it("archives a resolved day, returns deferred food, schedules it, and registers a shop", async () => {
    const database = new PGlite();
    await applyAllMigrations(database);

    const client = {
      query: (text: string, values?: unknown[]) => database.query(text, values),
      release: () => undefined,
    };
    state.pool = { connect: async () => client, query: client.query };
    const householdId = "22222222-2222-4222-8222-222222222222";
    const ownerId = "99999999-9999-4999-8999-999999999999";
    const memberId = "88888888-8888-4888-8888-888888888888";
    const actor = { householdId, userId: ownerId, displayName: "Alex", role: "owner" as const };
    await database.query("INSERT INTO households (id,name) VALUES ($1,'Kitchen')", [householdId]);
    await database.query(
      "INSERT INTO household_users (id,household_id,display_name,role) VALUES ($1,$3,'Alex','owner'),($2,$3,'Morgan','member')",
      [ownerId, memberId, householdId],
    );
    const dates = (
      await database.query<{ today: string; tomorrow: string }>(
        "SELECT current_date::text AS today,(current_date+1)::text AS tomorrow",
      )
    ).rows[0];

    const deferredMealId = "11111111-1111-4111-8111-111111111111";
    const finalPlannedId = "33333333-3333-4333-8333-333333333333";
    await database.query(
      `INSERT INTO meal_plan_entries (id,household_id,meal_date,meal_type,assigned_user_id,dish,status,notes)
       VALUES ($1,$3,$4,'lunch',$5,'Leftover curry','deferred','Still want this'),
              ($2,$3,$4,'dinner',NULL,'Pasta','planned',NULL)`,
      [deferredMealId, finalPlannedId, householdId, dates.today, memberId],
    );

    await updateMeal(actor, finalPlannedId, { status: "completed" });
    const archived = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM meal_plan_entries WHERE household_id=$1 AND meal_date=$2 AND archived_at IS NOT NULL",
      [householdId, dates.today],
    );
    expect(archived.rows[0].count).toBe(2);
    const returned = (
      await database.query<{ id: string; status: string; source: string }>(
        `SELECT id,status,source_meal_plan_entry_id AS source FROM unscheduled_items WHERE household_id=$1`,
        [householdId],
      )
    ).rows[0];
    expect(returned).toMatchObject({ status: "planned", source: deferredMealId });

    await scheduleUnscheduled(actor, returned.id, {
      mealDate: dates.tomorrow,
      mealType: "lunch",
      assignedUserId: memberId,
      packedLunch: true,
    });
    expect(
      (await database.query("SELECT id FROM unscheduled_items WHERE id=$1", [returned.id])).rows,
    ).toHaveLength(0);
    const scheduled = (
      await database.query<{ dish: string; status: string; packed_lunch: boolean }>(
        "SELECT dish,status,packed_lunch FROM meal_plan_entries WHERE household_id=$1 AND meal_date=$2 AND archived_at IS NULL",
        [householdId, dates.tomorrow],
      )
    ).rows[0];
    expect(scheduled).toEqual({ dish: "Leftover curry", status: "planned", packed_lunch: true });

    const locationId = "77777777-7777-4777-8777-777777777777";
    const onionsId = "66666666-6666-4666-8666-666666666666";
    const chipsId = "55555555-5555-4555-8555-555555555555";
    await database.query(
      "INSERT INTO storage_locations (id,household_id,name,detail) VALUES ($1,$2,'Fridge','Bottom shelf')",
      [locationId, householdId],
    );
    await database.query(
      `INSERT INTO shopping_items (id,household_id,item,category,quantity,unit,status)
       VALUES ($1,$3,'Red onions','Produce',0.5,'lb','purchased'),
              ($2,$3,'Plain chips','Snacks & Sweets',1,'bag','purchased')`,
      [onionsId, chipsId, householdId],
    );

    const registration = await registerGroceryShop(actor, {
      items: [
        {
          shoppingItemId: onionsId,
          action: "register",
          category: "Produce",
          quantity: "0.5",
          unit: "lb",
          storageLocationId: locationId,
          storageDetail: "Bottom shelf",
          packageState: "full",
          priority: "normal",
          notes: null,
        },
        { shoppingItemId: chipsId, action: "defer" },
      ],
    });
    expect(registration).toMatchObject({ registeredCount: 1, deferredCount: 1 });
    const inventory = (
      await database.query<{ id: string; quantity: string; storage_location_id: string }>(
        "SELECT id,quantity::text,storage_location_id FROM inventory_entries WHERE ingredient='Red onions'",
      )
    ).rows[0];
    expect(inventory).toMatchObject({ quantity: "0.500", storage_location_id: locationId });
    const shoppingStates = await database.query<{ item: string; status: string }>(
      "SELECT item,status FROM shopping_items ORDER BY item",
    );
    expect(shoppingStates.rows).toEqual([
      { item: "Plain chips", status: "deferred" },
      { item: "Red onions", status: "removed" },
    ]);

    const restockId = "44444444-4444-4444-8444-444444444444";
    await database.query(
      "INSERT INTO shopping_items (id,household_id,item,category,quantity,unit,status) VALUES ($1,$2,'Red onions','Produce',0.25,'lb','purchased')",
      [restockId, householdId],
    );
    await registerGroceryShop(actor, {
      items: [
        {
          shoppingItemId: restockId,
          action: "register",
          category: "Produce",
          quantity: "0.25",
          unit: "lb",
          storageLocationId: locationId,
          inventoryEntryId: inventory.id,
          storageDetail: "Bottom shelf",
          packageState: "full",
          priority: "normal",
          notes: null,
        },
      ],
    });
    expect(
      (
        await database.query<{ quantity: string }>(
          "SELECT quantity::text FROM inventory_entries WHERE id=$1",
          [inventory.id],
        )
      ).rows[0].quantity,
    ).toBe("0.750");
    const actions = await database.query<{ action: string }>("SELECT action FROM audit_events");
    expect(actions.rows.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["archive", "schedule", "register", "defer_registration"]),
    );

    await database.close();
  }, 30_000);

  it("allows a status-only update on a committed-style meal with long generated notes", async () => {
    const database = new PGlite();
    await applyAllMigrations(database);

    const client = {
      query: (text: string, values?: unknown[]) => database.query(text, values),
      release: () => undefined,
    };
    state.pool = { connect: async () => client, query: client.query };
    const householdId = "22222222-2222-4222-8222-222222222222";
    const ownerId = "99999999-9999-4999-8999-999999999999";
    const targetId = "33333333-3333-4333-8333-333333333333";
    const remainingId = "44444444-4444-4444-8444-444444444444";
    const actor = { householdId, userId: ownerId, displayName: "Alex", role: "owner" as const };
    const generatedNotes = "Detailed weekly-plan rationale and preparation context. ".repeat(14);
    expect(generatedNotes.length).toBeGreaterThan(500);
    await database.query("INSERT INTO households (id,name) VALUES ($1,'Kitchen')", [householdId]);
    await database.query(
      "INSERT INTO household_users (id,household_id,display_name,role) VALUES ($1,$2,'Alex','owner')",
      [ownerId, householdId],
    );
    await database.query(
      `INSERT INTO meal_plan_entries (id,household_id,meal_date,meal_type,dish,status,notes)
       VALUES ($1,$3,current_date,'dinner','Spanakopita','planned',$4),
              ($2,$3,current_date,'breakfast','Pancakes','planned',NULL)`,
      [targetId, remainingId, householdId, generatedNotes],
    );

    await updateMeal(actor, targetId, { status: "completed" });
    const updated = (
      await database.query<{ status: string; notes: string; archived_at: string | null }>(
        "SELECT status,notes,archived_at::text FROM meal_plan_entries WHERE id=$1",
        [targetId],
      )
    ).rows[0];
    expect(updated).toEqual({ status: "completed", notes: generatedNotes, archived_at: null });
    expect(
      (
        await database.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM audit_events WHERE entity_id=$1 AND action='update'",
          [targetId],
        )
      ).rows[0].count,
    ).toBe(1);
    await database.close();
  }, 30_000);

  it("prompts with editable inventory use after each archived day and retires the plan after its final day", async () => {
    const database = new PGlite();
    await applyAllMigrations(database);
    const client = {
      query: (text: string, values?: unknown[]) => database.query(text, values),
      release: () => undefined,
    };
    state.pool = { connect: async () => client, query: client.query };
    const householdId = "22222222-2222-4222-8222-222222222222";
    const ownerId = "99999999-9999-4999-8999-999999999999";
    const inventoryId = "66666666-6666-4666-8666-666666666666";
    const purchasedInventoryId = "77777777-7777-4777-8777-777777777777";
    const firstMealId = "11111111-1111-4111-8111-111111111111";
    const secondMealId = "33333333-3333-4333-8333-333333333333";
    const actor = { householdId, userId: ownerId, displayName: "Alex", role: "owner" as const };
    await database.query(
      "INSERT INTO households (id,name,timezone) VALUES ($1,'Kitchen','America/Vancouver')",
      [householdId],
    );
    await database.query(
      "INSERT INTO household_users (id,household_id,display_name,role) VALUES ($1,$2,'Alex','owner')",
      [ownerId, householdId],
    );
    await database.query(
      "INSERT INTO inventory_entries (id,household_id,ingredient,category,quantity,unit,package_state,priority) VALUES ($1,$2,'Jasmine rice','Pantry',1,'kg','opened','normal')",
      [inventoryId, householdId],
    );
    await database.query(
      "INSERT INTO inventory_entries (id,household_id,ingredient,category,quantity,unit,package_state,priority) VALUES ($1,$2,'Scallions','Produce',0.2,'kg','opened','normal')",
      [purchasedInventoryId, householdId],
    );
    const job = (
      await database.query<{ id: string }>(
        "INSERT INTO ai_jobs (household_id,actor_user_id,workflow,status,input_snapshot,completed_at) VALUES ($1,$2,'weekly_planning','completed','{}',now()) RETURNING id",
        [householdId, ownerId],
      )
    ).rows[0];
    const weekly = (
      await database.query<{ id: string }>(
        `INSERT INTO weekly_plans (household_id,job_id,created_by,committed_by,start_date,end_date,start_meal,end_meal,status,current_payload,committed_at) VALUES ($1,$2,$3,$3,current_date,current_date+1,'dinner','dinner','committed','{"planFormatVersion":2,"title":"Two dinners","summary":"Test","strategy":"Test","meals":[],"coverageExceptions":[],"shopping":[],"prepTasks":[],"warnings":[]}',now()) RETURNING id`,
        [householdId, job.id, ownerId],
      )
    ).rows[0];
    await database.query(
      `INSERT INTO meal_plan_entries (id,household_id,meal_date,meal_type,dish,status,weekly_plan_id,weekly_plan_meal_id,planned_inventory_uses)
       VALUES ($1,$3,current_date,'dinner','Rice bowl','planned',$4,'day-one',$5::jsonb),
              ($2,$3,current_date+1,'dinner','Fried rice','planned',$4,'day-two',$6::jsonb)`,
      [
        firstMealId,
        secondMealId,
        householdId,
        weekly.id,
        JSON.stringify([
          { inventoryEntryId: inventoryId, ingredient: "Jasmine rice", quantity: 0.4, unit: "kg" },
          { inventoryEntryId: null, ingredient: "Scallions", quantity: 0.1, unit: "kg" },
        ]),
        JSON.stringify([
          { inventoryEntryId: inventoryId, ingredient: "Jasmine rice", quantity: 0.3, unit: "kg" },
        ]),
      ],
    );

    await updateMeal(actor, firstMealId, { status: "completed" });
    expect(
      (
        await database.query<{ archivedAt: string | null }>(
          'SELECT archived_at::text AS "archivedAt" FROM weekly_plans WHERE id=$1',
          [weekly.id],
        )
      ).rows[0].archivedAt,
    ).toBeNull();
    const firstReview = (
      await database.query<{
        id: string;
        suggestions: Array<{ inventoryEntryId: string; suggestedQuantity: number }>;
      }>(
        `SELECT id,suggestions FROM meal_day_inventory_reviews WHERE household_id=$1 AND meal_date=current_date AND status='pending'`,
        [householdId],
      )
    ).rows[0];
    expect(firstReview.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryEntryId: inventoryId, suggestedQuantity: 0.4 }),
        expect.objectContaining({
          inventoryEntryId: purchasedInventoryId,
          ingredient: "Scallions",
          suggestedQuantity: 0.1,
        }),
      ]),
    );
    await resolveMealInventoryReview(actor, firstReview.id, {
      action: "apply",
      items: [{ inventoryEntryId: inventoryId, amount: 0.25, unit: "kg", addToShopping: false }],
    });
    expect(
      (
        await database.query<{ quantity: string }>(
          "SELECT quantity::text FROM inventory_entries WHERE id=$1",
          [inventoryId],
        )
      ).rows[0].quantity,
    ).toBe("0.750");
    expect(
      (
        await database.query<{ quantity: string }>(
          "SELECT quantity::text FROM inventory_entries WHERE id=$1",
          [purchasedInventoryId],
        )
      ).rows[0].quantity,
    ).toBe("0.200");

    await updateMeal(actor, secondMealId, { status: "completed" });
    expect(
      (
        await database.query<{ archivedAt: string | null }>(
          'SELECT archived_at::text AS "archivedAt" FROM weekly_plans WHERE id=$1',
          [weekly.id],
        )
      ).rows[0].archivedAt,
    ).not.toBeNull();
    expect(
      (
        await database.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM weekly_plans WHERE id=$1 AND archived_at IS NULL",
          [weekly.id],
        )
      ).rows[0].count,
    ).toBe(0);
    const secondReview = (
      await database.query<{ id: string; suggestions: Array<{ suggestedQuantity: number }> }>(
        `SELECT id,suggestions FROM meal_day_inventory_reviews WHERE household_id=$1 AND meal_date=current_date+1 AND status='pending'`,
        [householdId],
      )
    ).rows[0];
    expect(secondReview.suggestions[0].suggestedQuantity).toBe(0.3);
    await resolveMealInventoryReview(actor, secondReview.id, {
      action: "apply",
      items: [{ inventoryEntryId: inventoryId, amount: 0.5, unit: "kg", addToShopping: false }],
    });
    expect(
      (
        await database.query<{ quantity: string }>(
          "SELECT quantity::text FROM inventory_entries WHERE id=$1",
          [inventoryId],
        )
      ).rows[0].quantity,
    ).toBe("0.250");
    const planAudit = await database.query<{ source: string; reason: string }>(
      `SELECT source,reason FROM audit_events WHERE entity_type='weekly_plan' AND entity_id=$1 AND action='archive'`,
      [weekly.id],
    );
    expect(planAudit.rows).toEqual([
      expect.objectContaining({
        source: "system",
        reason: expect.stringMatching(/every committed meal-plan day/i),
      }),
    ]);
    await database.close();
  }, 40_000);
});
