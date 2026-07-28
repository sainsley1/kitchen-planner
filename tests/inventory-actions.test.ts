import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getPool: () => state.pool }));

import {
  bulkArchiveInventory,
  bulkUpdateInventory,
  consumeInventory,
  updateInventory,
} from "../lib/services/mutations";

describe("audited inventory actions", () => {
  it("adds depleted items to shopping and supports bulk update/archive", async () => {
    const database = new PGlite();
    await database.exec(`
      CREATE TABLE inventory_entries (
        id uuid PRIMARY KEY,
        household_id uuid NOT NULL,
        ingredient text NOT NULL,
        brand_variety text,
        category text NOT NULL,
        quantity numeric(12,3),
        unit text,
        storage_location_id uuid,
        storage_detail text,
        package_state text NOT NULL DEFAULT 'unknown',
        best_before date,
        priority text NOT NULL DEFAULT 'normal',
        notes text,
        archived_at timestamptz,
        verified_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE storage_locations (
        id uuid PRIMARY KEY,
        household_id uuid NOT NULL,
        active boolean NOT NULL DEFAULT true
      );
      CREATE TABLE shopping_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        household_id uuid NOT NULL,
        item text NOT NULL,
        category text,
        quantity numeric(12,3),
        unit text,
        status text NOT NULL DEFAULT 'to_buy',
        notes text,
        inventory_entry_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE audit_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        household_id uuid NOT NULL,
        actor_user_id uuid,
        source text NOT NULL,
        action text NOT NULL,
        entity_type text NOT NULL,
        entity_id uuid,
        reason text,
        before_state jsonb,
        after_state jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const client = {
      query: (text: string, values?: unknown[]) => database.query(text, values),
      release: () => undefined,
    };
    state.pool = { connect: async () => client };
    const actor = {
      householdId: "22222222-2222-4222-8222-222222222222",
      userId: "99999999-9999-4999-8999-999999999999",
      displayName: "Alex",
      role: "owner" as const,
    };
    const pastaId = "11111111-1111-4111-8111-111111111111";
    const kiwiId = "33333333-3333-4333-8333-333333333333";
    await database.query(
      `
      INSERT INTO inventory_entries (id,household_id,ingredient,brand_variety,category,quantity,unit,package_state,priority)
      VALUES ($1,$2,'Scooby-Doo pasta','Heinz','Canned & Jarred',1,'can','sealed','normal'),
             ($3,$2,'Kiwis',NULL,'Fruit',4,'each','full','normal')
    `,
      [pastaId, actor.householdId, kiwiId],
    );

    await consumeInventory(actor, pastaId, 1, undefined, true);
    const depleted = await database.query<{ archived_at: Date | null }>(
      "SELECT archived_at FROM inventory_entries WHERE id=$1",
      [pastaId],
    );
    expect(depleted.rows[0].archived_at).toBeInstanceOf(Date);
    const pastaShopping = await database.query<{ item: string; quantity: string; unit: string }>(
      "SELECT item,quantity,unit FROM shopping_items WHERE inventory_entry_id=$1",
      [pastaId],
    );
    expect(pastaShopping.rows).toHaveLength(1);
    expect(pastaShopping.rows[0]).toMatchObject({ item: "Scooby-Doo pasta", unit: "can" });
    expect(Number(pastaShopping.rows[0].quantity)).toBe(1);

    await updateInventory(actor, kiwiId, {
      ingredient: "Kiwis",
      brandVariety: null,
      category: "Fruit",
      quantity: "0.5",
      unit: "each",
      storageLocationId: null,
      storageDetail: null,
      packageState: "full",
      bestBefore: null,
      priority: "normal",
      notes: null,
    });
    const exactQuantity = await database.query<{ quantity: string }>(
      "SELECT quantity::text FROM inventory_entries WHERE id=$1",
      [kiwiId],
    );
    expect(exactQuantity.rows[0].quantity).toBe("0.500");

    const bulkUpdated = await bulkUpdateInventory(actor, [kiwiId], {
      category: "Produce",
      priority: "use_soon",
    });
    expect(bulkUpdated.count).toBe(1);
    const kiwi = await database.query<{ category: string; priority: string }>(
      "SELECT category,priority FROM inventory_entries WHERE id=$1",
      [kiwiId],
    );
    expect(kiwi.rows[0]).toEqual({ category: "Produce", priority: "use_soon" });

    const bulkArchived = await bulkArchiveInventory(actor, [kiwiId], true);
    expect(bulkArchived.count).toBe(1);
    expect(
      (await database.query("SELECT id FROM shopping_items WHERE inventory_entry_id=$1", [kiwiId]))
        .rows,
    ).toHaveLength(1);
    const actions = await database.query<{ action: string }>(
      "SELECT action FROM audit_events ORDER BY created_at,id",
    );
    expect(actions.rows.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["consume", "create", "bulk_update", "bulk_archive"]),
    );

    await database.close();
  }, 20_000);
});
