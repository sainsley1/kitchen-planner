import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getPool: () => state.pool, poolOrThrow: () => state.pool }));
import {
  createFoodPreference,
  supersedeFoodPreference,
  updateFoodPreference,
} from "../lib/services/preferences";
import { listFoodPreferences } from "../lib/db/queries";

describe("visible planning preferences", () => {
  it("creates, edits, lists and supersedes person-specific context rules", async () => {
    const database = new PGlite();
    await database.exec(await fs.readFile("drizzle/0000_initial.sql", "utf8"));
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
    const created = await createFoodPreference(actor, {
      userId: memberId,
      topic: "Packed work lunches",
      classification: "hard_constraint",
      detail: "Choose low-aroma food at work.",
      context: "Weekday packed lunches",
      status: "contextual",
      effectiveDate: "2026-07-16",
    });
    await updateFoodPreference(actor, created.id, {
      userId: memberId,
      topic: "Packed work lunches",
      classification: "hard_constraint",
      detail: "Choose low-aroma food in packed work lunches.",
      context: "Does not apply at home",
      status: "contextual",
      effectiveDate: "2026-07-16",
    });
    expect(await listFoodPreferences(householdId)).toEqual([
      expect.objectContaining({
        displayName: "Morgan",
        topic: "Packed work lunches",
        detail: "Choose low-aroma food in packed work lunches.",
        context: "Does not apply at home",
        status: "contextual",
      }),
    ]);
    await supersedeFoodPreference(actor, created.id);
    expect((await listFoodPreferences(householdId))[0].status).toBe("superseded");
    expect(
      (
        await database.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM audit_events WHERE entity_type='food_preference'",
        )
      ).rows[0].count,
    ).toBe(3);
    await database.close();
  }, 30_000);
});
