import "server-only";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/client";
import type { HouseholdSession } from "@/lib/auth/session";
import {
  feedbackInput,
  groceryRegistrationInput,
  inventoryBulkPatch,
  inventoryInput,
  mealInventoryReviewInput,
  mealInput,
  mealPatch,
  scheduleUnscheduledInput,
  householdTimezoneInput,
  shoppingBulkStatusInput,
  shoppingInput,
  shoppingPatch,
  unscheduledInput,
  unscheduledPatch,
} from "@/lib/validation";
import { parseImportPayload, resolutionInput } from "@/lib/import/contracts";
import { consumeInventorySql } from "@/lib/db/sql";
import { formatQuantity } from "@/lib/format";
import { z } from "zod";

type Actor = HouseholdSession;

async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new Error("Database is not configured");
  const client = await pool.connect();
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
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  beforeState: unknown,
  afterState: unknown,
  reason?: string,
  source: "ui" | "system" = "ui",
) {
  await auditMany(
    client,
    actor,
    action,
    entityType,
    [{ entityId, beforeState, afterState, reason }],
    source,
  );
}

async function auditMany(
  client: PoolClient,
  actor: Actor,
  action: string,
  entityType: string,
  events: {
    entityId: string | null;
    beforeState: unknown;
    afterState: unknown;
    reason?: string;
  }[],
  source: "ui" | "system" = "ui",
) {
  if (events.length === 0) return;
  const auditValues = [];
  const auditPlaceholders = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const baseIndex = i * 9;
    auditPlaceholders.push(
      `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}::jsonb, $${baseIndex + 9}::jsonb)`,
    );

    auditValues.push(
      actor.householdId,
      actor.userId,
      source,
      action,
      entityType,
      event.entityId,
      event.reason ?? null,
      JSON.stringify(event.beforeState ?? null),
      JSON.stringify(event.afterState ?? null),
    );
  }
  await client.query(
    `INSERT INTO audit_events (household_id, actor_user_id, source, action, entity_type, entity_id, reason, before_state, after_state) VALUES ${auditPlaceholders.join(", ")}`,
    auditValues,
  );
}

async function getOwned(client: PoolClient, table: string, id: string, householdId: string) {
  if (
    !/^(inventory_entries|shopping_items|meal_plan_entries|meal_feedback|unscheduled_items)$/.test(
      table,
    )
  )
    throw new Error("Unsupported entity table");
  const result = await client.query(
    `SELECT * FROM ${table} WHERE id=$1 AND household_id=$2 FOR UPDATE`,
    [id, householdId],
  );
  if (!result.rows[0]) throw new Error("Record not found");
  return result.rows[0];
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error("Stored meal date is invalid");
  return match[0];
}

async function assertHouseholdUser(client: PoolClient, actor: Actor, userId: string | null) {
  if (!userId) return;
  const owned = await client.query(
    "SELECT 1 FROM household_users WHERE id=$1 AND household_id=$2 AND active=true",
    [userId, actor.householdId],
  );
  if (!owned.rows[0]) throw new Error("Assigned household member was not found");
}

async function assertStorageLocation(client: PoolClient, actor: Actor, locationId: string | null) {
  if (!locationId) return;
  const owned = await client.query(
    "SELECT 1 FROM storage_locations WHERE id=$1 AND household_id=$2 AND active=true",
    [locationId, actor.householdId],
  );
  if (!owned.rows[0]) throw new Error("The selected storage location was not found");
}

type PlannedInventoryUse = {
  inventoryEntryId: string | null;
  ingredient: string;
  quantity: number | null;
  unit: string | null;
};
function plannedUses(value: unknown): PlannedInventoryUse[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (item.inventoryEntryId != null && typeof item.inventoryEntryId !== "string") return [];
    if (typeof item.ingredient !== "string") return [];
    const quantity = item.quantity == null ? null : Number(item.quantity);
    return [
      {
        inventoryEntryId: typeof item.inventoryEntryId === "string" ? item.inventoryEntryId : null,
        ingredient: item.ingredient,
        quantity: Number.isFinite(quantity) ? quantity : null,
        unit: typeof item.unit === "string" ? item.unit : null,
      },
    ];
  });
}
function normalizedUnit(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/\.$/, "");
}
function normalizedIngredient(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function ingredientMatchScore(planned: PlannedInventoryUse, item: Record<string, unknown>) {
  const plannedName = normalizedIngredient(planned.ingredient);
  const actualName = normalizedIngredient(item.ingredient);
  if (!plannedName || !actualName) return 0;
  if (plannedName !== actualName) return 0;
  const plannedUnit = normalizedUnit(planned.unit);
  const actualUnit = normalizedUnit(item.unit);
  return 10 + (!plannedUnit || !actualUnit || plannedUnit === actualUnit ? 2 : 0);
}

async function createMealInventoryReview(
  client: PoolClient,
  actor: Actor,
  mealDate: string,
  entries: Array<Record<string, unknown>>,
) {
  const planned = entries.flatMap((entry) =>
    plannedUses(entry.planned_inventory_uses).map((use) => ({
      use,
      mealId: String(entry.id),
      dish: String(entry.dish),
    })),
  );
  if (!planned.length) return null;
  const inventory = await client.query(
    `SELECT id,ingredient,quantity::text,unit FROM inventory_entries WHERE household_id=$1 AND archived_at IS NULL AND quantity IS NOT NULL FOR UPDATE`,
    [actor.householdId],
  );
  const inventoryById = new Map(inventory.rows.map((item) => [String(item.id), item]));
  const explicitInventoryIds = new Set(
    planned
      .map((entry) => entry.use.inventoryEntryId)
      .filter((id): id is string => Boolean(id && inventoryById.has(id))),
  );
  const grouped = new Map<
    string,
    {
      inventoryEntryId: string;
      ingredient: string;
      quantity: number | null;
      unit: string | null;
      mealIds: string[];
      dishes: string[];
      unitMismatch: boolean;
    }
  >();
  for (const entry of planned) {
    let item = entry.use.inventoryEntryId ? inventoryById.get(entry.use.inventoryEntryId) : null;
    if (!item) {
      const unreserved = inventory.rows.filter(
        (candidate) => !explicitInventoryIds.has(String(candidate.id)),
      );
      const candidatePool = unreserved.some(
        (candidate) => ingredientMatchScore(entry.use, candidate) > 0,
      )
        ? unreserved
        : inventory.rows;
      const ranked = candidatePool
        .map((candidate) => ({ candidate, score: ingredientMatchScore(entry.use, candidate) }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score);
      if (ranked.length && (!ranked[1] || ranked[0].score > ranked[1].score))
        item = ranked[0].candidate;
    }
    if (!item) continue;
    const key = String(item.id);
    const existing = grouped.get(key);
    if (existing) {
      existing.mealIds.push(entry.mealId);
      existing.dishes.push(entry.dish);
      if (existing.quantity == null || entry.use.quantity == null) existing.quantity = null;
      else if (normalizedUnit(existing.unit) === normalizedUnit(entry.use.unit))
        existing.quantity = Number((existing.quantity + entry.use.quantity).toFixed(3));
      else {
        existing.quantity = null;
        existing.unitMismatch = true;
      }
    } else {
      const unitMismatch = Boolean(
        entry.use.unit && item.unit && normalizedUnit(entry.use.unit) !== normalizedUnit(item.unit),
      );
      grouped.set(key, {
        inventoryEntryId: key,
        ingredient: String(item.ingredient),
        quantity: entry.use.quantity,
        unit: entry.use.unit,
        mealIds: [entry.mealId],
        dishes: [entry.dish],
        unitMismatch,
      });
    }
  }
  if (!grouped.size) return null;
  const suggestions = [...grouped.values()].flatMap((plannedUse) => {
    const item = inventoryById.get(plannedUse.inventoryEntryId);
    if (!item) return [];
    const available = item.quantity == null ? null : Number(item.quantity);
    if (available == null) return [];
    const unitMismatch =
      plannedUse.unitMismatch ||
      Boolean(
        plannedUse.unit &&
        item.unit &&
        normalizedUnit(plannedUse.unit) !== normalizedUnit(item.unit),
      );
    const suggestedQuantity =
      plannedUse.quantity == null || unitMismatch
        ? null
        : Number(Math.min(plannedUse.quantity, available).toFixed(3));
    return [
      {
        inventoryEntryId: item.id,
        ingredient: item.ingredient,
        suggestedQuantity,
        plannedQuantity: plannedUse.quantity,
        plannedUnit: plannedUse.unit,
        availableQuantity: available,
        unit: item.unit ?? plannedUse.unit,
        selectedByDefault: suggestedQuantity != null && suggestedQuantity > 0,
        unitMismatch,
        mealEntryIds: [...new Set(plannedUse.mealIds)],
        dishes: [...new Set(plannedUse.dishes)],
      },
    ];
  });
  if (!suggestions.length) return null;
  const created = await client.query<{ id: string }>(
    `
    INSERT INTO meal_day_inventory_reviews (household_id,meal_date,suggestions,status,created_by)
    VALUES ($1,$2::date,$3::jsonb,'pending',$4)
    ON CONFLICT (household_id,meal_date) WHERE status='pending'
    DO UPDATE SET suggestions=EXCLUDED.suggestions,created_by=EXCLUDED.created_by,created_at=now()
    RETURNING id
  `,
    [actor.householdId, mealDate, JSON.stringify(suggestions), actor.userId],
  );
  await audit(
    client,
    actor,
    "create",
    "meal_day_inventory_review",
    created.rows[0].id,
    null,
    { mealDate, suggestions },
    `Prepared inventory-use review for archived meal day ${mealDate}`,
    "system",
  );
  return created.rows[0].id;
}

async function retireWeeklyPlansIfComplete(client: PoolClient, actor: Actor, planIds: string[]) {
  const ids = [...new Set(planIds.filter(Boolean))];
  if (!ids.length) return [];
  const retired = await client.query(
    `
    UPDATE weekly_plans AS plan
       SET archived_at=now(),updated_at=now()
     WHERE plan.household_id=$1
       AND plan.id=ANY($2::uuid[])
       AND plan.status='committed'
       AND plan.archived_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM meal_plan_entries AS entry
          WHERE entry.weekly_plan_id=plan.id
            AND entry.archived_at IS NULL
       )
    RETURNING *
  `,
    [actor.householdId, ids],
  );
  for (const after of retired.rows)
    await audit(
      client,
      actor,
      "archive",
      "weekly_plan",
      after.id,
      { status: "committed", archivedAt: null },
      after,
      "Archived automatically because every committed meal-plan day is resolved",
      "system",
    );
  return retired.rows.map((row) => row.id as string);
}

async function archiveMealDayIfComplete(client: PoolClient, actor: Actor, mealDate: string) {
  const active = await client.query(
    `SELECT * FROM meal_plan_entries
      WHERE household_id=$1 AND meal_date=$2::date AND archived_at IS NULL
      ORDER BY id FOR UPDATE`,
    [actor.householdId, mealDate],
  );
  if (!active.rows.length || active.rows.some((entry) => entry.status === "planned")) {
    return { archived: false, deferredCount: 0 };
  }
  const inventoryReviewId = await createMealInventoryReview(client, actor, mealDate, active.rows);

  const currentWeek = await client.query<{ week_start: string }>(
    `SELECT (local_date - (((extract(dow FROM local_date))::integer + 1) % 7))::text AS week_start
       FROM (SELECT (now() AT TIME ZONE timezone)::date AS local_date FROM households WHERE id=$1) context`,
    [actor.householdId],
  );
  let deferredCount = 0;
  for (const entry of active.rows.filter((row) => row.status === "deferred")) {
    const sourceDate = dateOnly(entry.meal_date);
    const archiveNote = `Deferred from archived meal plan (${sourceDate}).`;
    const notes = [entry.notes, archiveNote].filter(Boolean).join("\n");
    const created = await client.query(
      `INSERT INTO unscheduled_items (
        household_id,week_start,item_type,assigned_user_id,title,recipe_id,
        planned_yield,status,notes,source_meal_plan_entry_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'planned',$8,$9)
      ON CONFLICT (source_meal_plan_entry_id) DO NOTHING
      RETURNING *`,
      [
        actor.householdId,
        currentWeek.rows[0].week_start,
        entry.meal_type,
        entry.assigned_user_id,
        entry.dish,
        entry.recipe_id,
        entry.planned_yield,
        notes,
        entry.id,
      ],
    );
    if (created.rows[0]) {
      deferredCount += 1;
      await audit(
        client,
        actor,
        "create",
        "unscheduled_item",
        created.rows[0].id,
        null,
        created.rows[0],
        "Returned a deferred meal from an archived day",
      );
    }
  }

  const archived = await client.query(
    `UPDATE meal_plan_entries
        SET archived_at=now(),updated_at=now()
      WHERE household_id=$1 AND meal_date=$2::date AND archived_at IS NULL
      RETURNING *`,
    [actor.householdId, mealDate],
  );
  for (const after of archived.rows) {
    const before = active.rows.find((entry) => entry.id === after.id);
    await audit(
      client,
      actor,
      "archive",
      "meal_plan_entry",
      after.id,
      before,
      after,
      "Archived automatically because the day has no Planned entries",
      "system",
    );
  }
  const archivedPlanIds = await retireWeeklyPlansIfComplete(
    client,
    actor,
    active.rows.map((entry) => entry.weekly_plan_id).filter(Boolean),
  );
  return { archived: true, deferredCount, inventoryReviewId, archivedPlanIds };
}

async function addInventoryToShopping(
  client: PoolClient,
  actor: Actor,
  inventory: Record<string, unknown>,
  reason: string,
) {
  const ingredient = String(inventory.ingredient);
  const existing = await client.query(
    `
    SELECT * FROM shopping_items
    WHERE household_id=$1
      AND status IN ('to_buy','deferred')
      AND (inventory_entry_id=$2 OR lower(item)=lower($3))
    ORDER BY CASE status WHEN 'to_buy' THEN 0 ELSE 1 END, created_at
    LIMIT 1
    FOR UPDATE
  `,
    [actor.householdId, inventory.id, ingredient],
  );

  if (existing.rows[0]) {
    if (existing.rows[0].status === "deferred") {
      const resumed = await client.query(
        "UPDATE shopping_items SET status='to_buy',updated_at=now() WHERE id=$1 AND household_id=$2 RETURNING *",
        [existing.rows[0].id, actor.householdId],
      );
      await audit(
        client,
        actor,
        "update",
        "shopping_item",
        resumed.rows[0].id,
        existing.rows[0],
        resumed.rows[0],
        reason,
      );
      return resumed.rows[0];
    }
    return existing.rows[0];
  }

  const brand = inventory.brand_variety ? ` Preferred: ${inventory.brand_variety}.` : "";
  const notes = `${reason}.${brand}`.trim();
  const created = await client.query(
    `
    INSERT INTO shopping_items
      (household_id,item,category,quantity,unit,status,notes,inventory_entry_id)
    VALUES ($1,$2,$3,$4,$5,'to_buy',$6,$7)
    RETURNING *
  `,
    [
      actor.householdId,
      ingredient,
      inventory.category ?? null,
      inventory.quantity ?? null,
      inventory.unit ?? null,
      notes,
      inventory.id,
    ],
  );
  await audit(
    client,
    actor,
    "create",
    "shopping_item",
    created.rows[0].id,
    null,
    created.rows[0],
    reason,
  );
  return created.rows[0];
}

export async function createInventory(actor: Actor, input: z.input<typeof inventoryInput>) {
  const value = inventoryInput.parse(input);
  return transaction(async (client) => {
    const result = await client.query(
      `
      INSERT INTO inventory_entries (household_id, ingredient, brand_variety, category, quantity, unit, storage_location_id, storage_detail, package_state, best_before, priority, notes, verified_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()) RETURNING *
    `,
      [
        actor.householdId,
        value.ingredient,
        value.brandVariety,
        value.category,
        value.quantity,
        value.unit,
        value.storageLocationId,
        value.storageDetail,
        value.packageState,
        value.bestBefore,
        value.priority,
        value.notes,
      ],
    );
    await audit(
      client,
      actor,
      "create",
      "inventory_entry",
      result.rows[0].id,
      null,
      result.rows[0],
    );
    return result.rows[0];
  });
}

export async function updateInventory(
  actor: Actor,
  id: string,
  input: z.input<typeof inventoryInput>,
  addToShopping = false,
) {
  const value = inventoryInput.parse(input);
  return transaction(async (client) => {
    const before = await getOwned(client, "inventory_entries", id, actor.householdId);
    const result = await client.query(
      `
      UPDATE inventory_entries SET ingredient=$3, brand_variety=$4, category=$5, quantity=$6::numeric, unit=$7,
        storage_location_id=$8, storage_detail=$9, package_state=$10, best_before=$11, priority=$12, notes=$13,
        archived_at=CASE WHEN $6::numeric=0 THEN now() ELSE archived_at END, verified_at=now(), updated_at=now()
      WHERE id=$1 AND household_id=$2 RETURNING *
    `,
      [
        id,
        actor.householdId,
        value.ingredient,
        value.brandVariety,
        value.category,
        value.quantity,
        value.unit,
        value.storageLocationId,
        value.storageDetail,
        value.packageState,
        value.bestBefore,
        value.priority,
        value.notes,
      ],
    );
    await audit(client, actor, "update", "inventory_entry", id, before, result.rows[0]);
    if (
      addToShopping &&
      before.quantity != null &&
      Number(before.quantity) > 0 &&
      value.quantity === 0
    ) {
      await addInventoryToShopping(
        client,
        actor,
        before,
        "Added automatically when inventory was set to zero",
      );
    }
    return result.rows[0];
  });
}

export async function consumeInventory(
  actor: Actor,
  id: string,
  amount: number,
  reason?: string,
  addToShopping = false,
) {
  return transaction(async (client) => {
    const before = await getOwned(client, "inventory_entries", id, actor.householdId);
    if (before.quantity == null)
      throw new Error("Set a numeric quantity before consuming this item");
    const remaining = Number(before.quantity) - amount;
    if (remaining < 0)
      throw new Error(`Only ${formatQuantity(before.quantity)} ${before.unit ?? ""} is recorded`);
    const result = await client.query(consumeInventorySql, [id, actor.householdId, remaining]);
    await audit(
      client,
      actor,
      "consume",
      "inventory_entry",
      id,
      before,
      result.rows[0],
      reason || `Consumed ${amount} ${before.unit ?? ""}`.trim(),
    );
    if (addToShopping && remaining === 0) {
      await addInventoryToShopping(
        client,
        actor,
        before,
        "Added automatically when inventory was consumed",
      );
    }
    return result.rows[0];
  });
}

export async function archiveInventory(actor: Actor, id: string, addToShopping = false) {
  return transaction(async (client) => {
    const before = await getOwned(client, "inventory_entries", id, actor.householdId);
    const result = await client.query(
      "UPDATE inventory_entries SET archived_at=now(), updated_at=now() WHERE id=$1 AND household_id=$2 RETURNING *",
      [id, actor.householdId],
    );
    await audit(
      client,
      actor,
      "archive",
      "inventory_entry",
      id,
      before,
      result.rows[0],
      "Removed through inventory interface",
    );
    if (addToShopping) {
      await addInventoryToShopping(
        client,
        actor,
        before,
        "Added automatically when inventory was removed",
      );
    }
    return result.rows[0];
  });
}

export async function bulkUpdateInventory(actor: Actor, ids: string[], input: unknown) {
  const patch = inventoryBulkPatch.parse(input);
  const uniqueIds = [...new Set(ids)];
  return transaction(async (client) => {
    if (patch.storageLocationId) {
      const location = await client.query(
        "SELECT 1 FROM storage_locations WHERE id=$1 AND household_id=$2 AND active=true",
        [patch.storageLocationId, actor.householdId],
      );
      if (!location.rowCount) throw new Error("The selected storage location was not found");
    }

    const fields: Array<[keyof typeof patch, string]> = [
      ["category", "category"],
      ["unit", "unit"],
      ["storageLocationId", "storage_location_id"],
      ["storageDetail", "storage_detail"],
      ["packageState", "package_state"],
      ["bestBefore", "best_before"],
      ["priority", "priority"],
      ["notes", "notes"],
    ];
    const changedFields = fields.filter(([key]) =>
      Object.prototype.hasOwnProperty.call(patch, key),
    );
    const updated: unknown[] = [];

    for (const id of uniqueIds) {
      const before = await getOwned(client, "inventory_entries", id, actor.householdId);
      const values: unknown[] = [id, actor.householdId];
      const setters = changedFields.map(([key, column]) => {
        values.push(patch[key]);
        return `${column}=$${values.length}`;
      });
      setters.push("verified_at=now()", "updated_at=now()");
      const result = await client.query(
        `UPDATE inventory_entries SET ${setters.join(",")} WHERE id=$1 AND household_id=$2 RETURNING *`,
        values,
      );
      await audit(
        client,
        actor,
        "bulk_update",
        "inventory_entry",
        id,
        before,
        result.rows[0],
        `Bulk changed: ${changedFields.map(([key]) => key).join(", ")}`,
      );
      updated.push(result.rows[0]);
    }
    return { count: updated.length, items: updated };
  });
}

export async function bulkArchiveInventory(actor: Actor, ids: string[], addToShopping = false) {
  const uniqueIds = [...new Set(ids)];
  return transaction(async (client) => {
    const archived: unknown[] = [];
    for (const id of uniqueIds) {
      const before = await getOwned(client, "inventory_entries", id, actor.householdId);
      const result = await client.query(
        "UPDATE inventory_entries SET archived_at=now(),updated_at=now() WHERE id=$1 AND household_id=$2 RETURNING *",
        [id, actor.householdId],
      );
      await audit(
        client,
        actor,
        "bulk_archive",
        "inventory_entry",
        id,
        before,
        result.rows[0],
        "Removed through bulk inventory action",
      );
      if (addToShopping) {
        await addInventoryToShopping(
          client,
          actor,
          before,
          "Added automatically during bulk inventory removal",
        );
      }
      archived.push(result.rows[0]);
    }
    return { count: archived.length, items: archived };
  });
}

export async function createShoppingItem(actor: Actor, input: z.input<typeof shoppingInput>) {
  const value = shoppingInput.parse(input);
  return transaction(async (client) => {
    const result = await client.query(
      `INSERT INTO shopping_items (household_id,item,category,quantity,unit,status,notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        actor.householdId,
        value.item,
        value.category,
        value.quantity,
        value.unit,
        value.status,
        value.notes,
      ],
    );
    await audit(client, actor, "create", "shopping_item", result.rows[0].id, null, result.rows[0]);
    return result.rows[0];
  });
}

export async function updateShoppingItem(
  actor: Actor,
  id: string,
  input: z.input<typeof shoppingPatch>,
) {
  const patch = shoppingPatch.parse(input);
  return transaction(async (client) => {
    const before = await getOwned(client, "shopping_items", id, actor.householdId);
    const merged = shoppingInput.parse({
      item: before.item,
      category: before.category,
      quantity: before.quantity,
      unit: before.unit,
      status: before.status,
      notes: before.notes,
      ...patch,
    });
    const result = await client.query(
      `UPDATE shopping_items SET item=$3,category=$4,quantity=$5,unit=$6,status=$7,notes=$8,updated_at=now()
      WHERE id=$1 AND household_id=$2 RETURNING *`,
      [
        id,
        actor.householdId,
        merged.item,
        merged.category,
        merged.quantity,
        merged.unit,
        merged.status,
        merged.notes,
      ],
    );
    await audit(client, actor, "update", "shopping_item", id, before, result.rows[0]);
    return result.rows[0];
  });
}

export async function removeShoppingItem(actor: Actor, id: string) {
  return updateShoppingItem(actor, id, { status: "removed" });
}

export async function bulkUpdateShoppingStatus(
  actor: Actor,
  input: z.input<typeof shoppingBulkStatusInput>,
) {
  const value = shoppingBulkStatusInput.parse(input);
  const ids = [...new Set(value.ids)];
  return transaction(async (client) => {
    if (ids.length === 0) return { count: 0, items: [] };

    const readPlaceholders = ids.map((_, i) => `$${i + 2}`).join(", ");

    const beforeResult = await client.query(
      `SELECT * FROM shopping_items WHERE id IN (${readPlaceholders}) AND household_id=$1 FOR UPDATE`,
      [actor.householdId, ...ids],
    );

    const beforeMap = new Map();
    for (const row of beforeResult.rows) {
      if (!["to_buy", "purchased"].includes(row.status)) {
        throw new Error(`${row.item} is not available for this grocery trip`);
      }
      beforeMap.set(row.id, row);
    }

    if (beforeResult.rows.length !== ids.length) {
      throw new Error("Record not found");
    }

    const updatePlaceholders = ids.map((_, i) => `$${i + 3}`).join(", ");
    const updateResult = await client.query(
      `UPDATE shopping_items SET status=$2, updated_at=now() WHERE id IN (${updatePlaceholders}) AND household_id=$1 RETURNING *`,
      [actor.householdId, value.status, ...ids],
    );

    const auditEvents = updateResult.rows.map((row) => {
      const before = beforeMap.get(row.id);
      const reason =
        value.status === "purchased"
          ? "Selected for grocery registration"
          : "Removed from grocery registration selection";

      return {
        entityId: row.id,
        beforeState: before,
        afterState: row,
        reason,
      };
    });

    await auditMany(client, actor, "bulk_update", "shopping_item", auditEvents);

    return { count: updateResult.rows.length, items: updateResult.rows };
  });
}

export async function registerGroceryShop(
  actor: Actor,
  input: z.input<typeof groceryRegistrationInput>,
) {
  const value = groceryRegistrationInput.parse(input);
  return transaction(async (client) => {
    let registeredCount = 0;
    let deferredCount = 0;
    const inventoryItems: unknown[] = [];

    for (const line of value.items) {
      const shopping = await getOwned(
        client,
        "shopping_items",
        line.shoppingItemId,
        actor.householdId,
      );
      if (shopping.status !== "purchased") {
        throw new Error(`${shopping.item} is no longer marked as purchased`);
      }

      if (line.action === "defer") {
        const deferred = await client.query(
          "UPDATE shopping_items SET status='deferred',updated_at=now() WHERE id=$1 AND household_id=$2 RETURNING *",
          [shopping.id, actor.householdId],
        );
        await audit(
          client,
          actor,
          "defer_registration",
          "shopping_item",
          shopping.id,
          shopping,
          deferred.rows[0],
          "Deferred to a future grocery trip",
        );
        deferredCount += 1;
        continue;
      }

      await assertStorageLocation(client, actor, line.storageLocationId);
      const targetInventoryId = line.inventoryEntryId ?? shopping.inventory_entry_id;
      let inventory = targetInventoryId
        ? (
            await client.query(
              "SELECT * FROM inventory_entries WHERE id=$1 AND household_id=$2 FOR UPDATE",
              [targetInventoryId, actor.householdId],
            )
          ).rows[0]
        : null;
      if (targetInventoryId && !inventory)
        throw new Error(`The inventory match for ${shopping.item} no longer exists`);
      let stocked;
      const sameUnit = (inventory?.unit ?? "").toLowerCase() === (line.unit ?? "").toLowerCase();
      const canCombine =
        inventory && inventory.archived_at == null && inventory.quantity != null && sameUnit;
      if (inventory && inventory.archived_at == null && !sameUnit)
        throw new Error(
          `${shopping.item} cannot merge into ${inventory.ingredient} because the units differ`,
        );
      if (inventory && inventory.archived_at == null && inventory.quantity == null)
        throw new Error(
          `${shopping.item} cannot merge into ${inventory.ingredient} because its current quantity is unknown`,
        );

      if (inventory && (inventory.archived_at != null || canCombine)) {
        const nextQuantity = canCombine
          ? Number(inventory.quantity) + line.quantity
          : line.quantity;
        stocked = await client.query(
          `UPDATE inventory_entries SET
            category=$3,quantity=$4::numeric,unit=$5,storage_location_id=$6,storage_detail=$7,
            package_state=$8,priority=$9,notes=$10,archived_at=NULL,verified_at=now(),updated_at=now()
          WHERE id=$1 AND household_id=$2 RETURNING *`,
          [
            inventory.id,
            actor.householdId,
            line.category,
            nextQuantity,
            line.unit,
            line.storageLocationId,
            line.storageDetail,
            line.packageState,
            line.priority,
            line.notes ?? inventory.notes,
          ],
        );
        await audit(
          client,
          actor,
          "restock",
          "inventory_entry",
          inventory.id,
          inventory,
          stocked.rows[0],
          `Registered grocery purchase: ${shopping.item}`,
        );
      } else {
        stocked = await client.query(
          `INSERT INTO inventory_entries (
            household_id,ingredient,category,quantity,unit,storage_location_id,storage_detail,
            package_state,priority,notes,verified_at
          ) VALUES ($1,$2,$3,$4::numeric,$5,$6,$7,$8,$9,$10,now()) RETURNING *`,
          [
            actor.householdId,
            shopping.item,
            line.category,
            line.quantity,
            line.unit,
            line.storageLocationId,
            line.storageDetail,
            line.packageState,
            line.priority,
            line.notes,
          ],
        );
        inventory = stocked.rows[0];
        await audit(
          client,
          actor,
          "create",
          "inventory_entry",
          stocked.rows[0].id,
          null,
          stocked.rows[0],
          `Registered grocery purchase: ${shopping.item}`,
        );
      }

      const removed = await client.query(
        `UPDATE shopping_items SET status='removed',inventory_entry_id=$3,updated_at=now()
          WHERE id=$1 AND household_id=$2 RETURNING *`,
        [shopping.id, actor.householdId, stocked.rows[0].id],
      );
      await audit(
        client,
        actor,
        "register",
        "shopping_item",
        shopping.id,
        shopping,
        removed.rows[0],
        "Moved purchased item into inventory",
      );
      registeredCount += 1;
      inventoryItems.push(stocked.rows[0]);
    }

    return { registeredCount, deferredCount, inventoryItems };
  });
}

export async function resolveMealInventoryReview(actor: Actor, id: string, inputValue: unknown) {
  const input = mealInventoryReviewInput.parse(inputValue);
  return transaction(async (client) => {
    const review = await client.query(
      `SELECT * FROM meal_day_inventory_reviews WHERE id=$1 AND household_id=$2 AND status='pending' FOR UPDATE`,
      [id, actor.householdId],
    );
    if (!review.rows[0]) throw new Error("This inventory review is no longer pending");
    if (input.action === "dismiss") {
      const updated = await client.query(
        `UPDATE meal_day_inventory_reviews SET status='dismissed',resolved_by=$3,resolution=$4::jsonb,resolved_at=now() WHERE id=$1 AND household_id=$2 RETURNING *`,
        [id, actor.householdId, actor.userId, JSON.stringify({ action: "dismiss" })],
      );
      await audit(
        client,
        actor,
        "dismiss",
        "meal_day_inventory_review",
        id,
        review.rows[0],
        updated.rows[0],
        `Dismissed inventory review for ${dateOnly(review.rows[0].meal_date)}`,
      );
      return { id, status: "dismissed", updatedCount: 0 };
    }
    const suggestions = new Map<string, Record<string, unknown>>(
      (Array.isArray(review.rows[0].suggestions) ? review.rows[0].suggestions : []).map(
        (entry: Record<string, unknown>) => [String(entry.inventoryEntryId), entry],
      ),
    );
    const results: unknown[] = [];
    for (const line of input.items) {
      if (!suggestions.has(line.inventoryEntryId))
        throw new Error(
          "One or more selected inventory items are not part of this meal-day review",
        );
      const before = (
        await client.query(
          `SELECT * FROM inventory_entries WHERE id=$1 AND household_id=$2 AND archived_at IS NULL FOR UPDATE`,
          [line.inventoryEntryId, actor.householdId],
        )
      ).rows[0];
      if (!before) throw new Error("One or more selected inventory items are no longer available");
      if (before.quantity == null)
        throw new Error(
          `Set a numeric quantity for ${before.ingredient} before recording meal use`,
        );
      if (line.unit && before.unit && normalizedUnit(line.unit) !== normalizedUnit(before.unit))
        throw new Error(`${before.ingredient} is recorded in ${before.unit}, not ${line.unit}`);
      const remaining = Number((Number(before.quantity) - line.amount).toFixed(3));
      if (remaining < 0)
        throw new Error(
          `Only ${formatQuantity(before.quantity)} ${before.unit ?? ""} of ${before.ingredient} is recorded`,
        );
      const updated = (
        await client.query(consumeInventorySql, [
          line.inventoryEntryId,
          actor.householdId,
          remaining,
        ])
      ).rows[0];
      await audit(
        client,
        actor,
        "consume",
        "inventory_entry",
        line.inventoryEntryId,
        before,
        updated,
        `Used ${formatQuantity(line.amount)} ${before.unit ?? line.unit ?? ""} for meals archived on ${dateOnly(review.rows[0].meal_date)}`.trim(),
      );
      if (line.addToShopping && remaining === 0)
        await addInventoryToShopping(
          client,
          actor,
          before,
          "Added after confirming meal-plan inventory use",
        );
      results.push({
        inventoryEntryId: line.inventoryEntryId,
        amount: line.amount,
        unit: before.unit ?? line.unit,
        remaining,
      });
    }
    const resolution = { action: "apply", items: results };
    const updated = await client.query(
      `UPDATE meal_day_inventory_reviews SET status='applied',resolved_by=$3,resolution=$4::jsonb,resolved_at=now() WHERE id=$1 AND household_id=$2 RETURNING *`,
      [id, actor.householdId, actor.userId, JSON.stringify(resolution)],
    );
    await audit(
      client,
      actor,
      "apply",
      "meal_day_inventory_review",
      id,
      review.rows[0],
      updated.rows[0],
      `Applied ${results.length} inventory adjustment${results.length === 1 ? "" : "s"} for ${dateOnly(review.rows[0].meal_date)}`,
    );
    return { id, status: "applied", updatedCount: results.length, items: results };
  });
}

export async function createMeal(actor: Actor, input: z.input<typeof mealInput>) {
  const value = mealInput.parse(input);
  return transaction(async (client) => {
    await assertHouseholdUser(client, actor, value.assignedUserId);
    const result = await client.query(
      `INSERT INTO meal_plan_entries (household_id,meal_date,meal_type,assigned_user_id,dish,planned_yield,packed_lunch,status,notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        actor.householdId,
        value.mealDate,
        value.mealType,
        value.assignedUserId,
        value.dish,
        value.plannedYield,
        value.packedLunch,
        value.status,
        value.notes,
      ],
    );
    await audit(
      client,
      actor,
      "create",
      "meal_plan_entry",
      result.rows[0].id,
      null,
      result.rows[0],
    );
    await archiveMealDayIfComplete(client, actor, value.mealDate);
    return result.rows[0];
  });
}

export async function updateMeal(actor: Actor, id: string, input: z.input<typeof mealPatch>) {
  const patch = mealPatch.parse(input);
  return transaction(async (client) => {
    const before = await getOwned(client, "meal_plan_entries", id, actor.householdId);
    // Patch fields are already validated above. Preserve untouched database
    // values verbatim: committed weekly plans can legitimately contain richer
    // generated notes than the manual create form accepts.
    const merged = {
      mealDate: patch.mealDate ?? dateOnly(before.meal_date),
      mealType: patch.mealType ?? before.meal_type,
      assignedUserId:
        patch.assignedUserId !== undefined ? patch.assignedUserId : before.assigned_user_id,
      dish: patch.dish ?? before.dish,
      plannedYield: patch.plannedYield !== undefined ? patch.plannedYield : before.planned_yield,
      packedLunch: patch.packedLunch !== undefined ? patch.packedLunch : before.packed_lunch,
      status: patch.status ?? before.status,
      notes: patch.notes !== undefined ? patch.notes : before.notes,
    };
    await assertHouseholdUser(client, actor, merged.assignedUserId);
    const result = await client.query(
      `UPDATE meal_plan_entries SET meal_date=$3,meal_type=$4,assigned_user_id=$5,dish=$6,planned_yield=$7,packed_lunch=$8,status=$9,notes=$10,updated_at=now()
      WHERE id=$1 AND household_id=$2 RETURNING *`,
      [
        id,
        actor.householdId,
        merged.mealDate,
        merged.mealType,
        merged.assignedUserId,
        merged.dish,
        merged.plannedYield,
        merged.packedLunch,
        merged.status,
        merged.notes,
      ],
    );
    await audit(client, actor, "update", "meal_plan_entry", id, before, result.rows[0]);
    const oldDate = dateOnly(before.meal_date);
    await archiveMealDayIfComplete(client, actor, oldDate);
    if (merged.mealDate !== oldDate) await archiveMealDayIfComplete(client, actor, merged.mealDate);
    return result.rows[0];
  });
}

export async function deleteMeal(actor: Actor, id: string) {
  return transaction(async (client) => {
    const before = await getOwned(client, "meal_plan_entries", id, actor.householdId);
    await client.query("DELETE FROM meal_plan_entries WHERE id=$1 AND household_id=$2", [
      id,
      actor.householdId,
    ]);
    await audit(client, actor, "delete", "meal_plan_entry", id, before, null);
    await archiveMealDayIfComplete(client, actor, dateOnly(before.meal_date));
    if (before.weekly_plan_id)
      await retireWeeklyPlansIfComplete(client, actor, [before.weekly_plan_id]);
    return { id };
  });
}

export async function createUnscheduled(actor: Actor, input: z.input<typeof unscheduledInput>) {
  const value = unscheduledInput.parse(input);
  return transaction(async (client) => {
    await assertHouseholdUser(client, actor, value.assignedUserId);
    const result = await client.query(
      `INSERT INTO unscheduled_items (household_id,week_start,item_type,assigned_user_id,title,planned_yield,status,notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        actor.householdId,
        value.weekStart,
        value.itemType,
        value.assignedUserId,
        value.title,
        value.plannedYield,
        value.status,
        value.notes,
      ],
    );
    await audit(
      client,
      actor,
      "create",
      "unscheduled_item",
      result.rows[0].id,
      null,
      result.rows[0],
    );
    return result.rows[0];
  });
}

export async function updateUnscheduled(
  actor: Actor,
  id: string,
  input: z.input<typeof unscheduledPatch>,
) {
  const patch = unscheduledPatch.parse(input);
  return transaction(async (client) => {
    const before = await getOwned(client, "unscheduled_items", id, actor.householdId);
    const merged = unscheduledInput.parse({
      weekStart: dateOnly(before.week_start),
      itemType: before.item_type,
      assignedUserId: before.assigned_user_id,
      title: before.title,
      plannedYield: before.planned_yield,
      status: before.status,
      notes: before.notes,
      ...patch,
    });
    await assertHouseholdUser(client, actor, merged.assignedUserId);
    const result = await client.query(
      `UPDATE unscheduled_items SET week_start=$3,item_type=$4,assigned_user_id=$5,title=$6,planned_yield=$7,status=$8,notes=$9,updated_at=now()
      WHERE id=$1 AND household_id=$2 RETURNING *`,
      [
        id,
        actor.householdId,
        merged.weekStart,
        merged.itemType,
        merged.assignedUserId,
        merged.title,
        merged.plannedYield,
        merged.status,
        merged.notes,
      ],
    );
    await audit(client, actor, "update", "unscheduled_item", id, before, result.rows[0]);
    return result.rows[0];
  });
}

export async function deleteUnscheduled(actor: Actor, id: string) {
  return transaction(async (client) => {
    const before = await getOwned(client, "unscheduled_items", id, actor.householdId);
    await client.query("DELETE FROM unscheduled_items WHERE id=$1 AND household_id=$2", [
      id,
      actor.householdId,
    ]);
    await audit(client, actor, "delete", "unscheduled_item", id, before, null);
    return { id };
  });
}

export async function scheduleUnscheduled(
  actor: Actor,
  id: string,
  input: z.input<typeof scheduleUnscheduledInput>,
) {
  const value = scheduleUnscheduledInput.parse(input);
  return transaction(async (client) => {
    const before = await getOwned(client, "unscheduled_items", id, actor.householdId);
    const current = await client.query<{ today: string }>(
      "SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM households WHERE id=$1",
      [actor.householdId],
    );
    if (value.mealDate < current.rows[0].today) throw new Error("Choose today or a future date");
    await assertHouseholdUser(client, actor, value.assignedUserId);

    const created = await client.query(
      `INSERT INTO meal_plan_entries (
        household_id,meal_date,meal_type,assigned_user_id,dish,recipe_id,
        planned_yield,packed_lunch,status,notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'planned',$9) RETURNING *`,
      [
        actor.householdId,
        value.mealDate,
        value.mealType,
        value.assignedUserId,
        before.title,
        before.recipe_id,
        before.planned_yield,
        value.packedLunch,
        before.notes,
      ],
    );
    await audit(
      client,
      actor,
      "create",
      "meal_plan_entry",
      created.rows[0].id,
      null,
      created.rows[0],
      "Scheduled from Unscheduled items",
    );
    await client.query("DELETE FROM unscheduled_items WHERE id=$1 AND household_id=$2", [
      id,
      actor.householdId,
    ]);
    await audit(
      client,
      actor,
      "schedule",
      "unscheduled_item",
      id,
      before,
      null,
      `Scheduled for ${value.mealDate} ${value.mealType}`,
    );
    return created.rows[0];
  });
}

const destinationTables: Record<string, string> = {
  inventory_entry: "inventory_entries",
  food_preference: "food_preferences",
  meal_feedback: "meal_feedback",
  staple_target: "staple_targets",
  shopping_item: "shopping_items",
  meal_plan_entry: "meal_plan_entries",
  unscheduled_item: "unscheduled_items",
};

export async function resolveImportRow(actor: Actor, id: string, input: unknown) {
  if (actor.role !== "owner") throw new Error("Only a household owner can resolve imported rows");
  const value = resolutionInput.parse(input);
  return transaction(async (client) => {
    const result = await client.query(
      `SELECT r.*,b.household_id,b.status AS batch_status,b.committed_at
      FROM import_rows r JOIN import_batches b ON b.id=r.batch_id
      WHERE r.id=$1 AND b.household_id=$2 FOR UPDATE OF r,b`,
      [id, actor.householdId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Record not found");
    if (!row.requires_reconciliation) throw new Error("This row does not require reconciliation");
    if (row.committed_at || row.batch_status === "committed")
      throw new Error("This import batch has already been committed");

    let payload: Record<string, unknown> | null = null;
    let targetId: string | null = null;
    if (
      value.action === "import" ||
      value.action === "import_unscheduled" ||
      value.action === "replace_existing"
    ) {
      if (value.action === "import_unscheduled" && row.destination_type !== "unscheduled_item")
        throw new Error("Only an unscheduled workbook row can use that action");
      payload = parseImportPayload(row.destination_type, value.payload ?? row.normalized_payload);
    }
    if (value.action === "use_existing" || value.action === "replace_existing") {
      if (!value.targetId) throw new Error("Choose the existing record to use");
      const candidates = Array.isArray(row.duplicate_candidates) ? row.duplicate_candidates : [];
      if (
        !candidates.some(
          (candidate: { id?: string; synthetic?: boolean }) =>
            candidate.id === value.targetId && !candidate.synthetic,
        )
      )
        throw new Error("Starter fixtures cannot be retained as the canonical record");
      const table = destinationTables[row.destination_type];
      if (!table)
        throw new Error("The staged destination cannot be reconciled to an existing record");
      const owned = await client.query(`SELECT 1 FROM ${table} WHERE id=$1 AND household_id=$2`, [
        value.targetId,
        actor.householdId,
      ]);
      if (!owned.rowCount) throw new Error("The selected existing record no longer exists");
      targetId = value.targetId;
    }
    if (value.action === "skip") payload = null;

    const before = {
      resolutionAction: row.resolution_action,
      resolutionPayload: row.resolution_payload,
      resolutionTargetId: row.resolution_target_id,
    };
    const updated = await client.query(
      `UPDATE import_rows SET resolution_action=$3,resolution_payload=$4::jsonb,resolution_target_id=$5,resolved_by=$6,resolved_at=now()
      WHERE id=$1 AND batch_id=$2 RETURNING *`,
      [id, row.batch_id, value.action, JSON.stringify(payload), targetId, actor.userId],
    );
    const counts = await client.query(
      `UPDATE import_batches b SET resolved_rows=(SELECT count(*)::int FROM import_rows r WHERE r.batch_id=b.id AND r.requires_reconciliation AND r.resolved_at IS NOT NULL)
      WHERE b.id=$1 RETURNING resolved_rows,reconciliation_rows`,
      [row.batch_id],
    );
    await audit(
      client,
      actor,
      "resolve",
      "import_row",
      id,
      before,
      { action: value.action, payload, targetId },
      `Reconciled ${row.source_sheet} row ${row.source_row}`,
    );
    return {
      row: updated.rows[0],
      resolvedRows: counts.rows[0].resolved_rows,
      reconciliationRows: counts.rows[0].reconciliation_rows,
    };
  });
}

export async function updateHouseholdTimezone(
  actor: Actor,
  input: z.input<typeof householdTimezoneInput>,
) {
  if (actor.role !== "owner")
    throw new Error("Only a household owner can change the household time zone");
  const value = householdTimezoneInput.parse(input);
  return transaction(async (client) => {
    const current = await client.query("SELECT * FROM households WHERE id=$1 FOR UPDATE", [
      actor.householdId,
    ]);
    if (!current.rows[0]) throw new Error("Household not found");
    const updated = await client.query(
      "UPDATE households SET timezone=$2,updated_at=now() WHERE id=$1 RETURNING *",
      [actor.householdId, value.timeZone],
    );
    await audit(
      client,
      actor,
      "update",
      "household",
      actor.householdId,
      current.rows[0],
      updated.rows[0],
      "Changed household time zone",
    );
    return updated.rows[0];
  });
}

export async function archiveImportBatch(actor: Actor, id: string) {
  if (actor.role !== "owner") throw new Error("Only a household owner can remove workbook imports");
  return transaction(async (client) => {
    const current = await client.query(
      "SELECT * FROM import_batches WHERE id=$1 AND household_id=$2 AND archived_at IS NULL FOR UPDATE",
      [id, actor.householdId],
    );
    if (!current.rows[0]) throw new Error("Workbook import not found");
    const updated = await client.query(
      "UPDATE import_batches SET archived_at=now() WHERE id=$1 AND household_id=$2 RETURNING *",
      [id, actor.householdId],
    );
    await audit(
      client,
      actor,
      "archive",
      "import_batch",
      id,
      current.rows[0],
      updated.rows[0],
      "Removed old workbook import from Settings",
    );
    return { id };
  });
}

export async function createFeedback(actor: Actor, input: z.input<typeof feedbackInput>) {
  const value = feedbackInput.parse(input);
  return transaction(async (client) => {
    if (value.userId) {
      const owned = await client.query(
        "SELECT 1 FROM household_users WHERE id=$1 AND household_id=$2 AND active=true",
        [value.userId, actor.householdId],
      );
      if (!owned.rowCount) throw new Error("Household member was not found");
    }
    if (value.recipeId) {
      const owned = await client.query(
        "SELECT 1 FROM recipes WHERE id=$1 AND household_id=$2 AND archived_at IS NULL",
        [value.recipeId, actor.householdId],
      );
      if (!owned.rows[0]) throw new Error("Saved recipe was not found");
    }
    const result = await client.query(
      `INSERT INTO meal_feedback (household_id,user_id,recipe_id,feedback_date,dish,rating,feedback,next_time_changes,repeat_decision)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        actor.householdId,
        value.userId,
        value.recipeId,
        value.feedbackDate,
        value.dish,
        value.rating,
        value.feedback,
        value.nextTimeChanges,
        value.repeatDecision,
      ],
    );
    await audit(client, actor, "create", "meal_feedback", result.rows[0].id, null, result.rows[0]);
    return result.rows[0];
  });
}

export async function deleteFeedback(actor: Actor, id: string) {
  return transaction(async (client) => {
    const before = await getOwned(client, "meal_feedback", id, actor.householdId);
    await client.query("DELETE FROM meal_feedback WHERE id=$1 AND household_id=$2", [
      id,
      actor.householdId,
    ]);
    await audit(client, actor, "delete", "meal_feedback", id, before, null);
    return { id };
  });
}
