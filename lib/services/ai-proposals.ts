import "server-only";
import type { PoolClient } from "pg";
import type { HouseholdSession } from "@/lib/auth/session";
import { getPool } from "@/lib/db/client";
import { feedbackInput, inventoryInput, shoppingInput } from "@/lib/validation";
import {
  feedbackLearningProposalSchema,
  proposalDecisionInput,
  quickUpdateProposalSchema,
} from "@/lib/ai/contracts";

type Actor = HouseholdSession;

async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const pool = getPool();
  if (!pool) throw new Error("Database is not configured");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
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
  before: unknown,
  after: unknown,
  reason: string,
) {
  await client.query(
    `INSERT INTO audit_events (household_id,actor_user_id,source,action,entity_type,entity_id,reason,before_state,after_state) VALUES ($1,$2,'ai',$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,
    [
      actor.householdId,
      actor.userId,
      action,
      entityType,
      entityId,
      reason,
      JSON.stringify(before ?? null),
      JSON.stringify(after ?? null),
    ],
  );
}

async function assertLocation(client: PoolClient, actor: Actor, id: string | null) {
  if (!id) return;
  const result = await client.query(
    "SELECT 1 FROM storage_locations WHERE id=$1 AND household_id=$2 AND active=true",
    [id, actor.householdId],
  );
  if (!result.rows.length) throw new Error("A proposed storage location is no longer available");
}
async function assertUser(client: PoolClient, actor: Actor, id: string | null) {
  if (!id) return;
  const result = await client.query(
    "SELECT 1 FROM household_users WHERE id=$1 AND household_id=$2 AND active=true",
    [id, actor.householdId],
  );
  if (!result.rows.length) throw new Error("A proposed household member is no longer available");
}

async function addInventoryShoppingLine(
  client: PoolClient,
  actor: Actor,
  inventory: Record<string, unknown>,
  reason: string,
) {
  const existing = await client.query(
    `SELECT * FROM shopping_items WHERE household_id=$1 AND status IN ('to_buy','deferred') AND (inventory_entry_id=$2 OR lower(item)=lower($3)) ORDER BY CASE status WHEN 'to_buy' THEN 0 ELSE 1 END,created_at LIMIT 1 FOR UPDATE`,
    [actor.householdId, inventory.id, String(inventory.ingredient)],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].status === "deferred") {
      const resumed = await client.query(
        "UPDATE shopping_items SET status='to_buy',updated_at=now() WHERE id=$1 RETURNING *",
        [existing.rows[0].id],
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
  const created = await client.query(
    `INSERT INTO shopping_items (household_id,item,category,quantity,unit,status,notes,inventory_entry_id) VALUES ($1,$2,$3,$4,$5,'to_buy',$6,$7) RETURNING *`,
    [
      actor.householdId,
      inventory.ingredient,
      inventory.category ?? null,
      inventory.quantity ?? null,
      inventory.unit ?? null,
      reason,
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

async function commitQuick(
  client: PoolClient,
  actor: Actor,
  payload: unknown,
  selected: Set<string>,
) {
  const proposal = quickUpdateProposalSchema.parse(payload);
  const results: Array<{ actionId: string; entityType: string; entityId: string }> = [];
  for (const action of proposal.actions.filter((item) => selected.has(item.id))) {
    if (action.type === "inventory_quantity") {
      const before = (
        await client.query(
          "SELECT * FROM inventory_entries WHERE id=$1 AND household_id=$2 AND archived_at IS NULL FOR UPDATE",
          [action.inventoryEntryId, actor.householdId],
        )
      ).rows[0];
      if (!before) throw new Error(`${action.label}: inventory item no longer exists`);
      const current = before.quantity == null ? null : Number(before.quantity);
      let next: number;
      if (action.quantityMode === "set") next = action.quantity!;
      else {
        if (current == null) throw new Error(`${action.label}: current quantity is unknown`);
        next =
          action.quantityMode === "add" ? current + action.quantity! : current - action.quantity!;
      }
      next = Math.round((next + Number.EPSILON) * 1000) / 1000;
      if (next < 0) throw new Error(`${action.label}: would make quantity negative`);
      const updated = await client.query(
        `UPDATE inventory_entries SET quantity=$3::numeric,archived_at=CASE WHEN $3::numeric=0 THEN now() ELSE NULL END,verified_at=now(),updated_at=now() WHERE id=$1 AND household_id=$2 RETURNING *`,
        [before.id, actor.householdId, next],
      );
      await audit(
        client,
        actor,
        "update",
        "inventory_entry",
        before.id,
        before,
        updated.rows[0],
        action.explanation,
      );
      if (next === 0 && action.addToShopping)
        await addInventoryShoppingLine(
          client,
          actor,
          before,
          "Added when an AI-approved update depleted inventory",
        );
      results.push({ actionId: action.id, entityType: "inventory_entry", entityId: before.id });
    } else if (action.type === "inventory_move") {
      await assertLocation(client, actor, action.storageLocationId);
      const before = (
        await client.query(
          "SELECT * FROM inventory_entries WHERE id=$1 AND household_id=$2 AND archived_at IS NULL FOR UPDATE",
          [action.inventoryEntryId, actor.householdId],
        )
      ).rows[0];
      if (!before) throw new Error(`${action.label}: inventory item no longer exists`);
      const updated = await client.query(
        "UPDATE inventory_entries SET storage_location_id=$3,storage_detail=$4,verified_at=now(),updated_at=now() WHERE id=$1 AND household_id=$2 RETURNING *",
        [before.id, actor.householdId, action.storageLocationId, action.storageDetail],
      );
      await audit(
        client,
        actor,
        "move",
        "inventory_entry",
        before.id,
        before,
        updated.rows[0],
        action.explanation,
      );
      results.push({ actionId: action.id, entityType: "inventory_entry", entityId: before.id });
    } else if (action.type === "inventory_create") {
      await assertLocation(client, actor, action.storageLocationId);
      const value = inventoryInput.parse({
        ingredient: action.ingredient,
        brandVariety: action.brandVariety,
        category: action.category,
        quantity: action.quantity,
        unit: action.unit,
        storageLocationId: action.storageLocationId,
        storageDetail: action.storageDetail,
        packageState: action.packageState,
        bestBefore: null,
        priority: action.priority,
        notes: action.notes,
      });
      const created = await client.query(
        `INSERT INTO inventory_entries (household_id,ingredient,brand_variety,category,quantity,unit,storage_location_id,storage_detail,package_state,best_before,priority,notes,verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()) RETURNING *`,
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
        created.rows[0].id,
        null,
        created.rows[0],
        action.explanation,
      );
      results.push({
        actionId: action.id,
        entityType: "inventory_entry",
        entityId: created.rows[0].id,
      });
    } else if (action.type === "inventory_archive") {
      const before = (
        await client.query(
          "SELECT * FROM inventory_entries WHERE id=$1 AND household_id=$2 AND archived_at IS NULL FOR UPDATE",
          [action.inventoryEntryId, actor.householdId],
        )
      ).rows[0];
      if (!before) throw new Error(`${action.label}: inventory item no longer exists`);
      const archived = await client.query(
        "UPDATE inventory_entries SET archived_at=now(),updated_at=now() WHERE id=$1 RETURNING *",
        [before.id],
      );
      await audit(
        client,
        actor,
        "archive",
        "inventory_entry",
        before.id,
        before,
        archived.rows[0],
        action.explanation,
      );
      if (action.addToShopping)
        await addInventoryShoppingLine(
          client,
          actor,
          before,
          "Added when an AI-approved update removed inventory",
        );
      results.push({ actionId: action.id, entityType: "inventory_entry", entityId: before.id });
    } else if (action.type === "shopping_add") {
      const value = shoppingInput.parse({
        item: action.ingredient,
        category: action.category,
        quantity: action.quantity,
        unit: action.unit,
        status: "to_buy",
        notes: action.notes,
      });
      const created = await client.query(
        `INSERT INTO shopping_items (household_id,item,category,quantity,unit,status,notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
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
      await audit(
        client,
        actor,
        "create",
        "shopping_item",
        created.rows[0].id,
        null,
        created.rows[0],
        action.explanation,
      );
      results.push({
        actionId: action.id,
        entityType: "shopping_item",
        entityId: created.rows[0].id,
      });
    } else {
      const before = (
        await client.query(
          "SELECT * FROM shopping_items WHERE id=$1 AND household_id=$2 AND status<>'removed' FOR UPDATE",
          [action.shoppingItemId, actor.householdId],
        )
      ).rows[0];
      if (!before) throw new Error(`${action.label}: shopping item no longer exists`);
      const updated = await client.query(
        "UPDATE shopping_items SET status=$3,updated_at=now() WHERE id=$1 AND household_id=$2 RETURNING *",
        [before.id, actor.householdId, action.shoppingStatus],
      );
      await audit(
        client,
        actor,
        "update",
        "shopping_item",
        before.id,
        before,
        updated.rows[0],
        action.explanation,
      );
      results.push({ actionId: action.id, entityType: "shopping_item", entityId: before.id });
    }
  }
  return results;
}

async function commitFeedback(
  client: PoolClient,
  actor: Actor,
  payload: unknown,
  selected: Set<string>,
) {
  const proposal = feedbackLearningProposalSchema.parse(payload);
  const results: Array<{ actionId: string; entityType: string; entityId: string }> = [];
  for (const action of proposal.actions.filter((item) => selected.has(item.id))) {
    await assertUser(client, actor, action.userId);
    if (action.type === "feedback_create") {
      const value = feedbackInput.parse({
        feedbackDate: action.feedbackDate,
        userId: action.userId,
        dish: action.dish,
        rating: action.rating,
        feedback: action.feedback,
        nextTimeChanges: action.nextTimeChanges,
        repeatDecision: action.repeatDecision,
      });
      const created = await client.query(
        `INSERT INTO meal_feedback (household_id,user_id,feedback_date,dish,rating,feedback,next_time_changes,repeat_decision) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          actor.householdId,
          value.userId,
          value.feedbackDate,
          value.dish,
          value.rating,
          value.feedback,
          value.nextTimeChanges,
          value.repeatDecision,
        ],
      );
      await audit(
        client,
        actor,
        "create",
        "meal_feedback",
        created.rows[0].id,
        null,
        created.rows[0],
        action.explanation,
      );
      results.push({
        actionId: action.id,
        entityType: "meal_feedback",
        entityId: created.rows[0].id,
      });
    } else {
      const created = await client.query(
        `INSERT INTO food_preferences (household_id,user_id,topic,classification,detail,context,status,effective_date) VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT (now() AT TIME ZONE timezone)::date FROM households WHERE id=$1)) RETURNING *`,
        [
          actor.householdId,
          action.userId,
          action.topic,
          action.classification,
          action.detail,
          action.context,
          action.preferenceStatus,
        ],
      );
      await audit(
        client,
        actor,
        "create",
        "food_preference",
        created.rows[0].id,
        null,
        created.rows[0],
        action.explanation,
      );
      results.push({
        actionId: action.id,
        entityType: "food_preference",
        entityId: created.rows[0].id,
      });
    }
  }
  return results;
}

export async function commitAiProposal(actor: Actor, id: string, input: unknown) {
  const { actionIds } = proposalDecisionInput.parse(input);
  const selected = new Set(actionIds);
  return transaction(async (client) => {
    const proposal = (
      await client.query(
        `SELECT * FROM ai_proposals WHERE id=$1 AND household_id=$2 AND status='pending' AND expires_at>now() FOR UPDATE`,
        [id, actor.householdId],
      )
    ).rows[0];
    if (!proposal) throw new Error("This AI proposal is unavailable, expired, or already decided");
    const payloadActions = (proposal.payload as { actions?: Array<{ id: string }> }).actions ?? [];
    const available = new Set(payloadActions.map((action) => action.id));
    for (const actionId of selected)
      if (!available.has(actionId))
        throw new Error("The proposal contains an unknown selected action");
    const results =
      proposal.workflow === "quick_update"
        ? await commitQuick(client, actor, proposal.payload, selected)
        : proposal.workflow === "feedback_learning"
          ? await commitFeedback(client, actor, proposal.payload, selected)
          : (() => {
              throw new Error("This workflow does not create an approvable proposal");
            })();
    const updated = await client.query(
      `UPDATE ai_proposals SET status='approved',selected_action_ids=$3::jsonb,result_payload=$4::jsonb,approved_by=$5,approved_at=now() WHERE id=$1 AND household_id=$2 RETURNING id,status,workflow,payload,result_payload AS "resultPayload",approved_at::text AS "approvedAt"`,
      [id, actor.householdId, JSON.stringify(actionIds), JSON.stringify({ results }), actor.userId],
    );
    await audit(
      client,
      actor,
      "approve",
      "ai_proposal",
      id,
      { status: proposal.status, workflow: proposal.workflow, actionCount: payloadActions.length },
      { status: "approved", selectedActionIds: actionIds, results },
      `Approved ${results.length} of ${payloadActions.length} proposed actions`,
    );
    return updated.rows[0];
  });
}

export async function rejectAiProposal(actor: Actor, id: string) {
  return transaction(async (client) => {
    const proposal = (
      await client.query(
        "SELECT * FROM ai_proposals WHERE id=$1 AND household_id=$2 AND status='pending' FOR UPDATE",
        [id, actor.householdId],
      )
    ).rows[0];
    if (!proposal) throw new Error("This AI proposal is unavailable or already decided");
    const updated = await client.query(
      `UPDATE ai_proposals SET status='rejected',rejected_by=$3,rejected_at=now() WHERE id=$1 AND household_id=$2 RETURNING id,status,workflow,payload,rejected_at::text AS "rejectedAt"`,
      [id, actor.householdId, actor.userId],
    );
    await audit(
      client,
      actor,
      "reject",
      "ai_proposal",
      id,
      { status: proposal.status, workflow: proposal.workflow },
      { status: "rejected", workflow: proposal.workflow },
      "Rejected AI proposal without changing household data",
    );
    return updated.rows[0];
  });
}
