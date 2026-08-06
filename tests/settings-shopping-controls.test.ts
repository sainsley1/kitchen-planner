import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getPool: () => state.pool, poolOrThrow: () => state.pool }));

import {
  archiveImportBatch,
  bulkUpdateShoppingStatus,
  updateHouseholdTimezone,
} from "../lib/services/mutations";

describe("settings and shopping controls", () => {
  it("bulk-selects a grocery trip, changes timezone and archives an import with audit history", async () => {
    const database = new PGlite();
    for (const migration of [
      "0000_initial.sql",
      "0001_phase3_persistence.sql",
      "0002_phase4_cutover.sql",
      "0003_meal_and_shopping_workflows.sql",
      "0004_settings_and_shopping_cleanup.sql",
    ]) {
      await database.exec(await fs.readFile(`drizzle/${migration}`, "utf8"));
    }
    const client = {
      query: (text: string, values?: unknown[]) => database.query(text, values),
      release: () => undefined,
    };
    state.pool = { connect: async () => client };
    const householdId = "22222222-2222-4222-8222-222222222222";
    const userId = "99999999-9999-4999-8999-999999999999";
    const actor = { householdId, userId, displayName: "Alex", role: "owner" as const };
    await database.query("INSERT INTO households (id,name) VALUES ($1,'Kitchen')", [householdId]);
    await database.query(
      "INSERT INTO household_users (id,household_id,display_name,role) VALUES ($1,$2,'Alex','owner')",
      [userId, householdId],
    );
    const shopping = await database.query<{ id: string }>(
      "INSERT INTO shopping_items (household_id,item,status) VALUES ($1,'Cat food','to_buy'),($1,'Limes','to_buy') RETURNING id",
      [householdId],
    );

    const bulk = await bulkUpdateShoppingStatus(actor, {
      ids: shopping.rows.map((row) => row.id),
      status: "purchased",
    });
    expect(bulk.count).toBe(2);
    expect(
      (
        await database.query<{ status: string }>("SELECT status FROM shopping_items ORDER BY item")
      ).rows.every((row) => row.status === "purchased"),
    ).toBe(true);

    await updateHouseholdTimezone(actor, { timeZone: "America/Toronto" });
    expect(
      (
        await database.query<{ timezone: string }>("SELECT timezone FROM households WHERE id=$1", [
          householdId,
        ])
      ).rows[0].timezone,
    ).toBe("America/Toronto");

    const batch = (
      await database.query<{ id: string }>(
        "INSERT INTO import_batches (household_id,source_filename,source_checksum) VALUES ($1,'inventory.xlsx','abc') RETURNING id",
        [householdId],
      )
    ).rows[0];
    await archiveImportBatch(actor, batch.id);
    expect(
      (
        await database.query<{ archived_at: Date | null }>(
          "SELECT archived_at FROM import_batches WHERE id=$1",
          [batch.id],
        )
      ).rows[0].archived_at,
    ).toBeInstanceOf(Date);

    const audits = await database.query<{
      action: string;
      entity_type: string;
      before_state: unknown;
      after_state: unknown;
    }>(
      "SELECT action,entity_type,before_state,after_state FROM audit_events ORDER BY created_at,id",
    );
    expect(
      audits.rows.filter(
        (row) => row.action === "bulk_update" && row.entity_type === "shopping_item",
      ),
    ).toHaveLength(2);
    expect(
      audits.rows.some((row) => row.action === "update" && row.entity_type === "household"),
    ).toBe(true);
    expect(
      audits.rows.some((row) => row.action === "archive" && row.entity_type === "import_batch"),
    ).toBe(true);
    expect(
      audits.rows.every((row) => row.before_state !== undefined && row.after_state !== undefined),
    ).toBe(true);
    await database.close();
  }, 30_000);
});
