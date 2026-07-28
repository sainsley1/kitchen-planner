import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { HouseholdSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { getPool } from "@/lib/db/client";
import { attachmentInput, type AiAttachment } from "@/lib/ai/attachments";
import {
  flyerExtractionSchema,
  flyerSaleInputSchema,
  flyerSourceInputSchema,
  normalizeFlyerExtraction,
} from "@/lib/ai/contracts";
import { runStructured, type AiUsage } from "@/lib/ai/provider";

const FLYER_PROMPT = `Extract grocery sale items from the supplied flyer image, PDF, or exact public flyer URL. Return English item names while preserving meaningful brand and product names. Assign a practical grocery category. Copy sale prices, regular prices, explicitly advertised savings or discount percentages, units, package sizes, member restrictions, multi-buy quantities, limits, and validity evidence exactly when visible. For a multi-buy such as "2 for $6", set price to the total bundle price 6 and multiBuyQuantity to 2. When a regular comparison price is printed for that offer, regularPrice is the price for one item; for example, "2 for $6, regular $3.99 each" means price 6, multiBuyQuantity 2 and regularPrice 3.99. savingsAmount is also per item for a multi-buy; if the flyer prints only a total bundle saving, divide it by multiBuyQuantity and preserve the printed total plus that conversion in evidenceText. Use pricingUnit and evidenceText to preserve the visible price basis. Preserve an explicitly printed savings amount or discount even when a regular price is not shown; derive a missing savingsAmount or discountPercent only when both sale and regular prices are visibly supported on a comparable basis, and otherwise leave that derived value null. If a comparison price remains ambiguous, leave it null, describe the ambiguity in warnings and set confidence below 0.75. Always set prioritized false because only the household can prioritize a sale. Use confidence below 0.75 whenever text, dates, units, or conditions are unclear. Never infer an item, price, regular price, savings claim or condition not visible in the source. Every extracted sale remains proposed until a household member reviews it.`;
const decisionSchema = z.object({ status: z.enum(["proposed", "accepted", "rejected"]) });
const UPLOAD_ROOT = process.env.UPLOAD_ROOT ?? "/app/uploads";

function pool() {
  const value = getPool();
  if (!value) throw new Error("Database is not configured");
  return value;
}
async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function audit(
  client: PoolClient,
  actor: HouseholdSession,
  action: string,
  entityType: string,
  id: string,
  before: unknown,
  after: unknown,
  reason: string,
  source: "ui" | "ai" = "ui",
) {
  await client.query(
    `INSERT INTO audit_events (household_id,actor_user_id,source,action,entity_type,entity_id,reason,before_state,after_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
    [
      actor.householdId,
      actor.userId,
      source,
      action,
      entityType,
      id,
      reason,
      JSON.stringify(before ?? null),
      JSON.stringify(after ?? null),
    ],
  );
}
function cleanName(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  return `${randomUUID()}${[".png", ".jpg", ".jpeg", ".webp", ".pdf"].includes(ext) ? ext : ""}`;
}
function saleValues(input: ReturnType<typeof flyerSaleInputSchema.parse>) {
  const regular = input.regularPrice;
  const comparableSalePrice = Number((input.price / (input.multiBuyQuantity ?? 1)).toFixed(2));
  const derivedSavings =
    regular != null && regular >= comparableSalePrice
      ? Number((regular - comparableSalePrice).toFixed(2))
      : null;
  const savings = input.savingsAmount ?? derivedSavings;
  const derivedDiscount =
    regular != null && regular > 0 && derivedSavings != null
      ? Number(((derivedSavings / regular) * 100).toFixed(2))
      : null;
  return {
    ...input,
    savingsAmount: savings,
    discountPercent: input.discountPercent ?? derivedDiscount,
  };
}

async function startExtraction(actor: HouseholdSession, snapshot: unknown) {
  return transaction(async (client) => {
    const job = await client.query<{ id: string }>(
      `INSERT INTO ai_jobs (household_id,actor_user_id,workflow,status,input_snapshot,started_at) VALUES ($1,$2,'flyer_extraction','running',$3::jsonb,now()) RETURNING id`,
      [actor.householdId, actor.userId, JSON.stringify(snapshot)],
    );
    const run = await client.query<{ id: string }>(
      `INSERT INTO ai_runs (job_id,model,reasoning_effort,prompt_version,status,model_tier) VALUES ($1,$2,'low','flyer-extraction-v2-resilient-price-review','running','primary') RETURNING id`,
      [job.rows[0].id, appConfig.models.routine],
    );
    return { jobId: job.rows[0].id, runId: run.rows[0].id };
  });
}
async function finishExtraction(ids: { jobId: string; runId: string }, usage: AiUsage) {
  await transaction(async (client) => {
    await client.query(
      `UPDATE ai_runs SET response_id=$2,status='completed',input_tokens=$3,cached_input_tokens=$4,output_tokens=$5,total_tokens=$6,estimated_cost_usd=$7,latency_ms=$8,web_search_calls=$9,web_source_count=$10,completed_at=now() WHERE id=$1`,
      [
        ids.runId,
        usage.responseId,
        usage.inputTokens,
        usage.cachedInputTokens,
        usage.outputTokens,
        usage.totalTokens,
        usage.estimatedCostUsd,
        usage.latencyMs,
        usage.webSearchCalls,
        usage.webSourceCount,
      ],
    );
    await client.query(`UPDATE ai_jobs SET status='completed',completed_at=now() WHERE id=$1`, [
      ids.jobId,
    ]);
  });
}
async function failExtraction(ids: { jobId: string; runId: string }, error: unknown) {
  const message = (error instanceof Error ? error.message : "Flyer extraction failed").slice(
    0,
    2000,
  );
  await pool().query(
    `UPDATE ai_runs SET status='failed',error_message=$2,completed_at=now() WHERE id=$1`,
    [ids.runId, message],
  );
  await pool().query(
    `UPDATE ai_jobs SET status='failed',error_message=$2,completed_at=now() WHERE id=$1`,
    [ids.jobId, message],
  );
  return message;
}

export async function createFlyer(
  actor: HouseholdSession,
  inputValue: unknown,
  attachment?: AiAttachment,
  extract = true,
) {
  const input = flyerSourceInputSchema.parse(inputValue);
  if (!attachment && !input.sourceUrl && extract)
    throw new Error("Upload a flyer file, provide a public URL, or turn off AI extraction");
  let storagePath: string | null = null;
  let checksum: string | null = null;
  if (attachment) {
    const dir = path.join(UPLOAD_ROOT, "flyers");
    await mkdir(dir, { recursive: true });
    storagePath = path.join(dir, cleanName(attachment.filename));
    await writeFile(storagePath, attachment.bytes, { flag: "wx" });
    checksum = createHash("sha256").update(attachment.bytes).digest("hex");
  }
  const sourceType = attachment
    ? attachment.mimeType === "application/pdf"
      ? "pdf"
      : "image"
    : input.sourceUrl
      ? "url"
      : "manual";
  const flyer = await transaction(async (client) => {
    const created = await client.query<{ id: string }>(
      `INSERT INTO flyer_sources (household_id,store_name,store_location,valid_from,valid_until,source_type,source_url,original_filename,mime_type,storage_path,source_checksum,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'review',$12) RETURNING id`,
      [
        actor.householdId,
        input.storeName,
        input.storeLocation,
        input.validFrom,
        input.validUntil,
        sourceType,
        input.sourceUrl,
        attachment?.filename ?? null,
        attachment?.mimeType ?? null,
        storagePath,
        checksum,
        actor.userId,
      ],
    );
    await audit(
      client,
      actor,
      "create",
      "flyer_source",
      created.rows[0].id,
      null,
      { ...input, sourceType, originalFilename: attachment?.filename ?? null },
      `Added ${input.storeName} flyer for review`,
    );
    return created.rows[0];
  });
  if (!extract) return { ...flyer, extracted: 0, warnings: [] };
  if (!appConfig.aiConfigured)
    return {
      ...flyer,
      extracted: 0,
      warnings: ["OpenAI is not configured; add sale items manually."],
    };
  const ids = await startExtraction(actor, {
    flyerId: flyer.id,
    storeName: input.storeName,
    sourceType,
  });
  try {
    const request = JSON.stringify({
      storeName: input.storeName,
      storeLocation: input.storeLocation,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      sourceUrl: input.sourceUrl,
    });
    const result = await runStructured({
      householdId: actor.householdId,
      schema: flyerExtractionSchema,
      schemaName: "kitchen_flyer_extraction",
      instructions: FLYER_PROMPT,
      input: attachment ? attachmentInput(request, attachment) : request,
      modelTier: "primary",
      maxOutputTokens: 40_000,
      webSearch: Boolean(input.sourceUrl),
    });
    const extraction = normalizeFlyerExtraction(result.value);
    await transaction(async (client) => {
      for (const raw of extraction.sales) {
        const sale = saleValues({ ...raw, prioritized: false });
        await client.query(
          `INSERT INTO flyer_sale_items (flyer_source_id,household_id,item,brand,category,package_size,price,regular_price,savings_amount,discount_percent,pricing_unit,multi_buy_quantity,member_only,limit_text,notes,confidence,evidence_text,source_reference,status,prioritized) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'proposed',false)`,
          [
            flyer.id,
            actor.householdId,
            sale.item,
            sale.brand,
            sale.category,
            sale.packageSize,
            sale.price,
            sale.regularPrice,
            sale.savingsAmount,
            sale.discountPercent,
            sale.pricingUnit,
            sale.multiBuyQuantity,
            sale.memberOnly,
            sale.limitText,
            sale.notes,
            sale.confidence,
            sale.evidenceText,
            sale.sourceReference,
          ],
        );
      }
      await client.query(
        `UPDATE flyer_sources SET extraction_warnings=$2::jsonb,updated_at=now() WHERE id=$1`,
        [flyer.id, JSON.stringify(extraction.warnings)],
      );
      await audit(
        client,
        actor,
        "extract",
        "flyer_source",
        flyer.id,
        null,
        { saleCount: extraction.sales.length, warnings: extraction.warnings },
        `AI extracted ${extraction.sales.length} proposed flyer sale${extraction.sales.length === 1 ? "" : "s"}`,
        "ai",
      );
    });
    await finishExtraction(ids, result.usage);
    return { ...flyer, extracted: extraction.sales.length, warnings: extraction.warnings };
  } catch (error) {
    const warning = await failExtraction(ids, error);
    await pool().query(
      `UPDATE flyer_sources SET extraction_warnings=extraction_warnings||$2::jsonb,updated_at=now() WHERE id=$1`,
      [flyer.id, JSON.stringify([`AI extraction failed: ${warning}`])],
    );
    return { ...flyer, extracted: 0, warnings: [`AI extraction failed: ${warning}`] };
  }
}

async function ownedFlyer(client: PoolClient, actor: HouseholdSession, id: string, lock = false) {
  const result = await client.query(
    `SELECT * FROM flyer_sources WHERE id=$1 AND household_id=$2 AND archived_at IS NULL${lock ? " FOR UPDATE" : ""}`,
    [id, actor.householdId],
  );
  if (!result.rows[0]) throw new Error("Flyer not found");
  return result.rows[0];
}
export async function updateFlyer(actor: HouseholdSession, id: string, inputValue: unknown) {
  const input = flyerSourceInputSchema.parse(inputValue);
  return transaction(async (client) => {
    const before = await ownedFlyer(client, actor, id, true);
    if (before.status === "committed")
      throw new Error("Archive a committed flyer instead of changing its dates or store");
    const updated = await client.query(
      `UPDATE flyer_sources SET store_name=$3,store_location=$4,valid_from=$5,valid_until=$6,source_url=$7,updated_at=now() WHERE id=$1 AND household_id=$2 RETURNING *`,
      [
        id,
        actor.householdId,
        input.storeName,
        input.storeLocation,
        input.validFrom,
        input.validUntil,
        input.sourceUrl,
      ],
    );
    await audit(
      client,
      actor,
      "update",
      "flyer_source",
      id,
      before,
      updated.rows[0],
      `Updated ${input.storeName} flyer`,
    );
    return updated.rows[0];
  });
}
export async function archiveFlyer(actor: HouseholdSession, id: string) {
  return transaction(async (client) => {
    const before = await ownedFlyer(client, actor, id, true);
    const updated = await client.query(
      `UPDATE flyer_sources SET status='archived',archived_at=now(),updated_at=now() WHERE id=$1 RETURNING id,status`,
      [id],
    );
    await audit(
      client,
      actor,
      "archive",
      "flyer_source",
      id,
      before,
      updated.rows[0],
      `Archived ${before.store_name} flyer`,
    );
    return updated.rows[0];
  });
}

export async function archiveExpiredFlyers(actor: HouseholdSession) {
  return transaction(async (client) => {
    const expired = await client.query(
      `SELECT f.* FROM flyer_sources f JOIN households h ON h.id=f.household_id WHERE f.household_id=$1 AND f.archived_at IS NULL AND f.valid_until<(now() AT TIME ZONE h.timezone)::date ORDER BY f.valid_until,f.store_name FOR UPDATE`,
      [actor.householdId],
    );
    if (!expired.rows.length) return { count: 0, ids: [] as string[] };
    const updated = await client.query<{ id: string }>(
      `UPDATE flyer_sources f SET status='archived',archived_at=now(),updated_at=now() WHERE f.household_id=$1 AND f.id=ANY($2::uuid[]) RETURNING id`,
      [actor.householdId, expired.rows.map((row) => row.id)],
    );
    for (const before of expired.rows)
      await audit(
        client,
        actor,
        "bulk_archive",
        "flyer_source",
        before.id,
        before,
        { id: before.id, status: "archived" },
        `Archived expired ${before.store_name} flyer (ended ${String(before.valid_until).slice(0, 10)})`,
      );
    return { count: updated.rows.length, ids: updated.rows.map((row) => row.id) };
  });
}

export async function createFlyerSale(
  actor: HouseholdSession,
  flyerId: string,
  inputValue: unknown,
) {
  const input = saleValues(flyerSaleInputSchema.parse(inputValue));
  return transaction(async (client) => {
    await ownedFlyer(client, actor, flyerId, true);
    const created = await client.query<{ id: string }>(
      `INSERT INTO flyer_sale_items (flyer_source_id,household_id,item,brand,category,package_size,price,regular_price,savings_amount,discount_percent,pricing_unit,multi_buy_quantity,member_only,limit_text,notes,confidence,evidence_text,source_reference,status,prioritized) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
      [
        flyerId,
        actor.householdId,
        input.item,
        input.brand,
        input.category,
        input.packageSize,
        input.price,
        input.regularPrice,
        input.savingsAmount,
        input.discountPercent,
        input.pricingUnit,
        input.multiBuyQuantity,
        input.memberOnly,
        input.limitText,
        input.notes,
        input.confidence,
        input.evidenceText,
        input.sourceReference,
        input.status,
        input.prioritized,
      ],
    );
    await audit(
      client,
      actor,
      "create",
      "flyer_sale_item",
      created.rows[0].id,
      null,
      input,
      `Added ${input.item} sale`,
    );
    return created.rows[0];
  });
}
async function ownedSale(
  client: PoolClient,
  actor: HouseholdSession,
  flyerId: string,
  saleId: string,
) {
  const result = await client.query(
    `SELECT s.* FROM flyer_sale_items s JOIN flyer_sources f ON f.id=s.flyer_source_id WHERE s.id=$1 AND s.flyer_source_id=$2 AND s.household_id=$3 AND f.archived_at IS NULL FOR UPDATE`,
    [saleId, flyerId, actor.householdId],
  );
  if (!result.rows[0]) throw new Error("Flyer sale not found");
  return result.rows[0];
}
export async function updateFlyerSale(
  actor: HouseholdSession,
  flyerId: string,
  saleId: string,
  inputValue: unknown,
) {
  const input = saleValues(flyerSaleInputSchema.parse(inputValue));
  return transaction(async (client) => {
    const before = await ownedSale(client, actor, flyerId, saleId);
    const updated = await client.query(
      `UPDATE flyer_sale_items SET item=$4,brand=$5,category=$6,package_size=$7,price=$8,regular_price=$9,savings_amount=$10,discount_percent=$11,pricing_unit=$12,multi_buy_quantity=$13,member_only=$14,limit_text=$15,notes=$16,confidence=$17,evidence_text=$18,source_reference=$19,status=$20,prioritized=$21,updated_at=now() WHERE id=$1 AND flyer_source_id=$2 AND household_id=$3 RETURNING *`,
      [
        saleId,
        flyerId,
        actor.householdId,
        input.item,
        input.brand,
        input.category,
        input.packageSize,
        input.price,
        input.regularPrice,
        input.savingsAmount,
        input.discountPercent,
        input.pricingUnit,
        input.multiBuyQuantity,
        input.memberOnly,
        input.limitText,
        input.notes,
        input.confidence,
        input.evidenceText,
        input.sourceReference,
        input.status,
        input.prioritized,
      ],
    );
    await audit(
      client,
      actor,
      "update",
      "flyer_sale_item",
      saleId,
      before,
      updated.rows[0],
      `Reviewed ${input.item} flyer sale`,
    );
    return updated.rows[0];
  });
}
export async function decideFlyerSale(
  actor: HouseholdSession,
  flyerId: string,
  saleId: string,
  inputValue: unknown,
) {
  const { status } = decisionSchema.parse(inputValue);
  return transaction(async (client) => {
    const before = await ownedSale(client, actor, flyerId, saleId);
    const updated = await client.query(
      `UPDATE flyer_sale_items SET status=$4,updated_at=now() WHERE id=$1 AND flyer_source_id=$2 AND household_id=$3 RETURNING *`,
      [saleId, flyerId, actor.householdId, status],
    );
    await audit(
      client,
      actor,
      "review",
      "flyer_sale_item",
      saleId,
      before,
      updated.rows[0],
      `${status[0].toUpperCase() + status.slice(1)} ${before.item} flyer sale`,
    );
    return updated.rows[0];
  });
}
export async function prioritizeFlyerSale(
  actor: HouseholdSession,
  flyerId: string,
  saleId: string,
  prioritized: boolean,
) {
  return transaction(async (client) => {
    const before = await ownedSale(client, actor, flyerId, saleId);
    if (prioritized && before.status !== "accepted")
      throw new Error("Accept a sale before prioritizing it for meal planning");
    const updated = await client.query(
      `UPDATE flyer_sale_items SET prioritized=$4,updated_at=now() WHERE id=$1 AND flyer_source_id=$2 AND household_id=$3 RETURNING *`,
      [saleId, flyerId, actor.householdId, prioritized],
    );
    await audit(
      client,
      actor,
      "prioritize",
      "flyer_sale_item",
      saleId,
      before,
      updated.rows[0],
      `${prioritized ? "Prioritized" : "Removed priority from"} ${before.item} for meal planning`,
    );
    return updated.rows[0];
  });
}
export async function commitFlyer(actor: HouseholdSession, id: string) {
  return transaction(async (client) => {
    const before = await ownedFlyer(client, actor, id, true);
    if (before.status !== "review") throw new Error("Only a flyer under review can be committed");
    const counts = await client.query<{ proposed: number; accepted: number }>(
      `SELECT count(*) FILTER (WHERE status='proposed')::int AS proposed,count(*) FILTER (WHERE status='accepted')::int AS accepted FROM flyer_sale_items WHERE flyer_source_id=$1`,
      [id],
    );
    if (counts.rows[0].proposed)
      throw new Error(`Review all ${counts.rows[0].proposed} remaining proposed sale items first`);
    if (!counts.rows[0].accepted)
      throw new Error("Accept at least one sale item before committing this flyer");
    const updated = await client.query(
      `UPDATE flyer_sources SET status='committed',committed_by=$2,committed_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,
      [id, actor.userId],
    );
    await audit(
      client,
      actor,
      "commit",
      "flyer_source",
      id,
      before,
      updated.rows[0],
      `Committed ${before.store_name} flyer with ${counts.rows[0].accepted} verified sales`,
    );
    return { id, status: "committed", accepted: counts.rows[0].accepted };
  });
}
export async function getFlyerFile(actor: HouseholdSession, id: string) {
  const result = await pool().query<{
    storagePath: string;
    mimeType: string;
    originalFilename: string;
  }>(
    `SELECT storage_path AS "storagePath",mime_type AS "mimeType",original_filename AS "originalFilename" FROM flyer_sources WHERE id=$1 AND household_id=$2 AND archived_at IS NULL AND storage_path IS NOT NULL`,
    [id, actor.householdId],
  );
  if (!result.rows[0]) throw new Error("Flyer file not found");
  const root = path.resolve(UPLOAD_ROOT, "flyers");
  const resolved = path.resolve(result.rows[0].storagePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Invalid flyer file path");
  return { ...result.rows[0], bytes: await readFile(resolved) };
}
