import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getPool: () => state.pool }));

import { commitAiProposal, rejectAiProposal } from "../lib/services/ai-proposals";

const householdId = "22222222-2222-4222-8222-222222222222";
const ownerId = "99999999-9999-4999-8999-999999999999";
const memberId = "88888888-8888-4888-8888-888888888888";
const inventoryId = "66666666-6666-4666-8666-666666666666";
const actor = { householdId, userId: ownerId, displayName: "Alex", role: "owner" as const };

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
    "INSERT INTO household_users (id,household_id,display_name,role) VALUES ($1,$3,'Alex','owner'),($2,$3,'Morgan','member')",
    [ownerId, memberId, householdId],
  );
  return database;
}

async function insertProposal(
  database: PGlite,
  workflow: "quick_update" | "feedback_learning",
  payload: unknown,
) {
  const job = (
    await database.query<{ id: string }>(
      "INSERT INTO ai_jobs (household_id,actor_user_id,workflow,status) VALUES ($1,$2,$3,'completed') RETURNING id",
      [householdId, ownerId, workflow],
    )
  ).rows[0];
  return (
    await database.query<{ id: string }>(
      "INSERT INTO ai_proposals (household_id,job_id,workflow,payload) VALUES ($1,$2,$3,$4::jsonb) RETURNING id",
      [householdId, job.id, workflow, JSON.stringify(payload)],
    )
  ).rows[0].id;
}

function quickAction(overrides: Record<string, unknown>) {
  return {
    id: "action",
    type: "inventory_quantity",
    label: "Update inventory",
    explanation: "The user explicitly described this change",
    inventoryEntryId: null,
    quantityMode: null,
    quantity: null,
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
    ...overrides,
  };
}

describe("AI proposal decisions", () => {
  beforeEach(() => {
    state.pool = null;
  });

  it("applies only selected quick-update actions atomically and audits them as AI", async () => {
    const database = await createDatabase();
    await database.query(
      "INSERT INTO inventory_entries (id,household_id,ingredient,category,quantity,unit,package_state,priority) VALUES ($1,$2,'Orange soda','Beverages',1,'bottle','full','normal')",
      [inventoryId, householdId],
    );
    const payload = {
      title: "Kitchen update",
      summary: "Use the last orange soda and add nuts",
      warnings: [],
      actions: [
        quickAction({
          id: "drink",
          label: "Use the last orange soda",
          inventoryEntryId: inventoryId,
          quantityMode: "subtract",
          quantity: 1,
          addToShopping: true,
        }),
        quickAction({
          id: "nuts",
          type: "shopping_add",
          label: "Add mixed nuts",
          ingredient: "Mixed nuts",
          category: "Snacks & Sweets",
          quantity: 1,
          unit: "bag",
        }),
        quickAction({
          id: "ignored",
          type: "shopping_add",
          label: "Do not add crackers",
          ingredient: "Crackers",
          category: "Snacks & Sweets",
          quantity: 1,
          unit: "box",
        }),
      ],
    };
    const proposalId = await insertProposal(database, "quick_update", payload);

    const result = await commitAiProposal(actor, proposalId, { actionIds: ["drink", "nuts"] });
    expect(result.status).toBe("approved");
    const inventory = (
      await database.query<{ quantity: string; archived: boolean }>(
        "SELECT quantity::text,archived_at IS NOT NULL AS archived FROM inventory_entries WHERE id=$1",
        [inventoryId],
      )
    ).rows[0];
    expect(inventory).toEqual({ quantity: "0.000", archived: true });
    const shopping = await database.query<{ item: string; status: string }>(
      "SELECT item,status FROM shopping_items ORDER BY item",
    );
    expect(shopping.rows).toEqual([
      { item: "Mixed nuts", status: "to_buy" },
      { item: "Orange soda", status: "to_buy" },
    ]);
    const proposal = (
      await database.query<{ selected: string[]; count: number }>(
        "SELECT selected_action_ids AS selected,jsonb_array_length(result_payload->'results')::int AS count FROM ai_proposals WHERE id=$1",
        [proposalId],
      )
    ).rows[0];
    expect(proposal).toEqual({ selected: ["drink", "nuts"], count: 2 });
    const audits = await database.query<{ source: string; action: string }>(
      "SELECT source,action FROM audit_events ORDER BY created_at",
    );
    expect(audits.rows.every((event) => event.source === "ai")).toBe(true);
    expect(audits.rows.map((event) => event.action)).toEqual(
      expect.arrayContaining(["update", "create", "approve"]),
    );
    await database.close();
  }, 30_000);

  it("commits dish feedback and reusable learning only after approval", async () => {
    const database = await createDatabase();
    const payload = {
      title: "Pancake feedback",
      summary: "Record Morgan's feedback",
      warnings: [],
      actions: [
        {
          id: "feedback",
          type: "feedback_create",
          label: "Save feedback",
          explanation: "Morgan directly said this",
          userId: memberId,
          feedbackDate: "2026-07-15",
          dish: "Pancakes",
          rating: "Like",
          feedback: "The pancakes were very good.",
          nextTimeChanges: null,
          repeatDecision: "Repeat",
          topic: null,
          classification: null,
          detail: null,
          context: null,
          preferenceStatus: null,
        },
        {
          id: "preference",
          type: "preference_create",
          label: "Remember breakfast preference",
          explanation: "Useful for future plans",
          userId: memberId,
          feedbackDate: null,
          dish: null,
          rating: null,
          feedback: null,
          nextTimeChanges: null,
          repeatDecision: null,
          topic: "Breakfast",
          classification: "strong_preference",
          detail: "Morgan likes oatmeal for breakfast.",
          context: "Breakfast",
          preferenceStatus: "active",
        },
      ],
    };
    const proposalId = await insertProposal(database, "feedback_learning", payload);
    await commitAiProposal(actor, proposalId, { actionIds: ["feedback", "preference"] });
    expect(
      (await database.query<{ count: number }>("SELECT count(*)::int AS count FROM meal_feedback"))
        .rows[0].count,
    ).toBe(1);
    const preference = (
      await database.query<{ classification: string; detail: string }>(
        "SELECT classification,detail FROM food_preferences",
      )
    ).rows[0];
    expect(preference).toEqual({
      classification: "strong_preference",
      detail: "Morgan likes oatmeal for breakfast.",
    });
    await database.close();
  }, 30_000);

  it("rejects a proposal without changing household data", async () => {
    const database = await createDatabase();
    const payload = {
      title: "Unwanted update",
      summary: "No changes should be made",
      warnings: [],
      actions: [
        quickAction({
          id: "nuts",
          type: "shopping_add",
          label: "Add mixed nuts",
          ingredient: "Mixed nuts",
          category: "Snacks & Sweets",
          quantity: 1,
          unit: "bag",
        }),
      ],
    };
    const proposalId = await insertProposal(database, "quick_update", payload);
    const result = await rejectAiProposal(actor, proposalId);
    expect(result.status).toBe("rejected");
    expect(
      (await database.query<{ count: number }>("SELECT count(*)::int AS count FROM shopping_items"))
        .rows[0].count,
    ).toBe(0);
    const audit = (
      await database.query<{ source: string; action: string }>(
        "SELECT source,action FROM audit_events",
      )
    ).rows[0];
    expect(audit).toEqual({ source: "ai", action: "reject" });
    await database.close();
  }, 30_000);
});
