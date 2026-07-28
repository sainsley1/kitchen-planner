import "server-only";
import { z } from "zod";
import type { HouseholdSession } from "@/lib/auth/session";
import { getPool } from "@/lib/db/client";
import { parseImportPayload } from "@/lib/import/contracts";
import { enrichImportReconciliation } from "@/lib/import/staging";
import type { NormalizedImportRow } from "@/lib/import/workbook-normalize";

const metadataSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
});

export async function stageWorkbook(
  actor: HouseholdSession,
  metadata: unknown,
  parsedRows: NormalizedImportRow[],
) {
  if (actor.role !== "owner") throw new Error("Only a household owner can stage a workbook");
  const { filename, checksum } = metadataSchema.parse(metadata);
  const pool = getPool();
  if (!pool) throw new Error("Database is not configured");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prevalidated = parsedRows.map((row) => {
      if (!row.destinationType || !row.normalized) return row;
      try {
        parseImportPayload(row.destinationType, row.normalized);
        return row;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Normalized payload is invalid";
        return {
          ...row,
          status: "rejected" as const,
          requiresReconciliation: true,
          suggestedAction: "skip" as const,
          messages: [...row.messages, `Destination validation failed: ${detail}`],
        };
      }
    });
    const staged = await enrichImportReconciliation(client, actor.householdId, prevalidated);
    const counts = {
      sourceRows: staged.length,
      acceptedRows: staged.filter((row) => row.status === "valid").length,
      warningRows: staged.filter((row) => row.status === "warning").length,
      rejectedRows: staged.filter((row) => row.status === "rejected").length,
      reconciliationRows: staged.filter((row) => row.requiresReconciliation).length,
    };
    const batch = await client.query<{ id: string }>(
      `INSERT INTO import_batches (household_id,source_filename,source_checksum,dry_run,status,source_rows,accepted_rows,warning_rows,rejected_rows,reconciliation_rows,completed_at)
      VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,now()) RETURNING id`,
      [
        actor.householdId,
        filename,
        checksum,
        counts.rejectedRows ? "warning" : counts.warningRows ? "warning" : "valid",
        counts.sourceRows,
        counts.acceptedRows,
        counts.warningRows,
        counts.rejectedRows,
        counts.reconciliationRows,
      ],
    );
    const batchId = batch.rows[0].id;
    for (const row of staged)
      await client.query(
        `INSERT INTO import_rows
      (batch_id,source_sheet,source_row,status,raw_payload,normalized_payload,messages,destination_type,requires_reconciliation,suggested_action,duplicate_candidates)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11::jsonb)`,
        [
          batchId,
          row.sheet,
          row.row,
          row.status,
          JSON.stringify(row.raw),
          JSON.stringify(row.normalized),
          JSON.stringify(row.messages),
          row.destinationType,
          row.requiresReconciliation,
          row.suggestedAction,
          JSON.stringify(row.duplicateCandidates),
        ],
      );
    await client.query(
      `INSERT INTO audit_events (household_id,actor_user_id,source,action,entity_type,entity_id,reason,after_state)
      VALUES ($1,$2,'import','preview','import_batch',$3,'Workbook staged for user reconciliation; no production rows changed',$4::jsonb)`,
      [
        actor.householdId,
        actor.userId,
        batchId,
        JSON.stringify({ filename, checksum, ...counts, dryRun: true }),
      ],
    );
    await client.query("COMMIT");
    return {
      batchId,
      filename,
      checksum,
      dryRun: true,
      ...counts,
      sampleWarnings: staged
        .filter((row) => row.requiresReconciliation)
        .slice(0, 20)
        .map(({ sheet, row, status, messages, suggestedAction }) => ({
          sheet,
          row,
          status,
          messages,
          suggestedAction,
        })),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
