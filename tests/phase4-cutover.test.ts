import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { commitImportBatch } from "../scripts/lib/import-cutover.mjs";

describe("Phase 4 transactional cutover", () => {
  it("commits staged rows and unscheduled items atomically after reconciliation", async () => {
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
      "INSERT INTO household_users (household_id,display_name,role) VALUES ($1,'Alex','owner'),($1,'Morgan','member')",
      [household.id],
    );
    const batch = (
      await database.query<{ id: string }>(
        `INSERT INTO import_batches (household_id,source_filename,source_checksum,status,source_rows,accepted_rows,warning_rows,reconciliation_rows,resolved_rows)
      VALUES ($1,'inventory.xlsx','abc','warning',2,1,1,1,1) RETURNING id`,
        [household.id],
      )
    ).rows[0];
    const inventory = {
      ingredient: "Chickpeas",
      brandVariety: "Canned",
      category: "Canned & Jarred",
      quantity: 3,
      unit: "can",
      locationName: "Bookshelf",
      storageDetail: "Top shelf",
      packageState: "sealed",
      bestBefore: null,
      priority: "normal",
      notes: null,
      verifiedAt: "2026-07-14",
    };
    const hummus = {
      weekStart: "2026-07-11",
      itemType: "prep",
      assignedPerson: null,
      title: "Homemade hummus",
      recipeUrl: null,
      recipeNote: null,
      plannedYield: "Batch",
      status: "planned",
      notes: "Serve with cucumber sticks",
    };
    await database.query(
      `INSERT INTO import_rows (batch_id,source_sheet,source_row,status,raw_payload,normalized_payload,destination_type,requires_reconciliation,suggested_action)
      VALUES ($1,'Current Inventory',5,'valid','{}',$2::jsonb,'inventory_entry',false,'import')`,
      [batch.id, JSON.stringify(inventory)],
    );
    await database.query(
      `INSERT INTO import_rows (batch_id,source_sheet,source_row,status,raw_payload,normalized_payload,destination_type,requires_reconciliation,suggested_action,resolution_action,resolution_payload,resolved_at)
      VALUES ($1,'Meal Plan Data',33,'warning','{}',$2::jsonb,'unscheduled_item',true,'import_unscheduled','import_unscheduled',$2::jsonb,now())`,
      [batch.id, JSON.stringify(hummus)],
    );
    const result = await commitImportBatch(database, {
      batchId: batch.id,
      confirmation: "COMMIT",
      backupReference: "/backups/pre-cutover.dump",
    });
    expect(result.destinations.inventory_entry).toBe(1);
    expect(result.destinations.unscheduled_item).toBe(1);
    expect(
      (
        await database.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM inventory_entries",
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (await database.query<{ title: string }>("SELECT title FROM unscheduled_items")).rows[0]
        .title,
    ).toBe("Homemade hummus");
    expect(
      (
        await database.query<{ status: string }>("SELECT status FROM import_batches WHERE id=$1", [
          batch.id,
        ])
      ).rows[0].status,
    ).toBe("committed");
    await database.close();
  }, 20_000);
});
