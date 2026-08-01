import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pool: null as unknown,
  responses: [] as Array<{ value: unknown; usage: unknown }>,
}));

vi.mock("@/lib/db/client", () => ({ getPool: () => state.pool }));
vi.mock("@/lib/ai/provider", () => ({
  runStructured: async () => {
    const next = state.responses.shift();
    if (!next) throw new Error("No mock response queued");
    return { value: next.value, usage: next.usage, sources: [] };
  },
}));

import { reconcileImportBatchWithAi } from "../lib/services/import-reconciliation-ai";

const householdId = "22222222-2222-4222-8222-222222222222";
const ownerId = "99999999-9999-4999-8999-999999999999";
const memberId = "88888888-8888-4888-8888-888888888888";
const ownerActor = { householdId, userId: ownerId, displayName: "Alex", role: "owner" as const };
const memberActor = {
  householdId,
  userId: memberId,
  displayName: "Morgan",
  role: "member" as const,
};

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

describe("AI import reconciliation service", () => {
  beforeEach(() => {
    state.responses = [];
  });

  it("refuses non-owner execution", async () => {
    const db = await createDatabase();
    await expect(reconcileImportBatchWithAi(memberActor, "batch-123")).rejects.toThrow(
      "Only a household owner can reconcile an import batch",
    );
    await db.close();
  }, 15_000);

  it("reconciles unresolved rows with AI recommendations and records audit trail", async () => {
    const db = await createDatabase();

    const batchRes = await db.query<{ id: string }>(
      `INSERT INTO import_batches (household_id, source_filename, source_checksum, dry_run, status, source_rows, accepted_rows, warning_rows, rejected_rows, reconciliation_rows)
       VALUES ($1, 'test.xlsx', '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', true, 'warning', 2, 0, 2, 0, 2)
       RETURNING id`,
      [householdId],
    );
    const batchId = batchRes.rows[0].id;

    const row1Res = await db.query<{ id: string }>(
      `INSERT INTO import_rows (batch_id, source_sheet, source_row, status, raw_payload, normalized_payload, messages, destination_type, requires_reconciliation, suggested_action, duplicate_candidates)
       VALUES ($1, 'Pantry', 2, 'warning', '{"ingredient":"Org Tofu"}'::jsonb, '{"ingredient":"Tofu"}'::jsonb, '[]'::jsonb, 'inventory_entry', true, 'skip', '[]'::jsonb)
       RETURNING id`,
      [batchId],
    );
    const row1Id = row1Res.rows[0].id;

    state.responses.push({
      value: {
        summary: "Reconciled 1 unresolved item",
        recommendations: [
          {
            rowId: row1Id,
            recommendedAction: "import",
            targetId: null,
            confidence: "high",
            rationale: "Discovered no exact duplicate candidate; valid new inventory entry.",
          },
        ],
        warnings: [],
      },
      usage: { inputTokens: 500, outputTokens: 150 },
    });

    const result = await reconcileImportBatchWithAi(ownerActor, batchId);
    expect(result.updatedCount).toBe(1);

    const updatedRow = await db.query<{ suggested_action: string; messages: string[] }>(
      `SELECT suggested_action, messages FROM import_rows WHERE id = $1`,
      [row1Id],
    );
    expect(updatedRow.rows[0].suggested_action).toBe("import");
    expect(updatedRow.rows[0].messages[0]).toContain(
      "AI (high confidence): Discovered no exact duplicate candidate",
    );

    const audit = await db.query<{ action: string; source: string }>(
      `SELECT action, source FROM audit_events WHERE entity_id = $1`,
      [batchId],
    );
    expect(audit.rows[0]).toEqual({ action: "ai_reconcile", source: "ai" });

    await db.close();
  }, 15_000);
});
