import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { consumeInventorySql } from "../lib/db/sql";

describe("inventory consumption SQL", () => {
  it("uses an explicit numeric parameter and archives a fully consumed item", async () => {
    const database = new PGlite();
    await database.exec(`
      CREATE TABLE inventory_entries (
        id uuid PRIMARY KEY,
        household_id uuid NOT NULL,
        quantity numeric(12,3),
        archived_at timestamptz,
        notes text,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const householdId = "22222222-2222-4222-8222-222222222222";
    const finalItemId = "11111111-1111-4111-8111-111111111111";
    const partialItemId = "33333333-3333-4333-8333-333333333333";

    await database.query(
      "INSERT INTO inventory_entries (id,household_id,quantity,notes) VALUES ($1,$2,$3,$4),($5,$2,$6,$7)",
      [finalItemId, householdId, 1, null, partialItemId, 3, "Keep note"],
    );

    const finalResult = await database.query<{
      quantity: string;
      archived_at: Date | null;
      notes: string | null;
    }>(consumeInventorySql, [finalItemId, householdId, 0]);
    expect(Number(finalResult.rows[0].quantity)).toBe(0);
    expect(finalResult.rows[0].archived_at).toBeInstanceOf(Date);
    expect(finalResult.rows[0].notes).toBe("[Consumed]");

    const partialResult = await database.query<{
      quantity: string;
      archived_at: Date | null;
      notes: string | null;
    }>(consumeInventorySql, [partialItemId, householdId, 2]);
    expect(Number(partialResult.rows[0].quantity)).toBe(2);
    expect(partialResult.rows[0].archived_at).toBeNull();
    expect(partialResult.rows[0].notes).toBe("Keep note");

    await database.close();
  }, 20_000);
});
