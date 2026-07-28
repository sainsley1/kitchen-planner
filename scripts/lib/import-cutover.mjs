import { z } from "zod";

const nullableText = z
  .union([z.string().trim().max(2000), z.null()])
  .transform((value) => (value === "" ? null : value));
const nullableNumber = z
  .union([z.coerce.number().nonnegative(), z.literal(""), z.null()])
  .transform((value) => (value === "" || value == null ? null : value));
const optionalDate = z
  .union([z.string().date(), z.literal(""), z.null()])
  .transform((value) => value || null);
const person = nullableText;
const recipeUrl = z
  .union([z.string().url().startsWith("http").max(2000), z.literal(""), z.null()])
  .transform((value) => value || null);
const mealType = z.enum(["breakfast", "lunch", "dinner", "snack", "dessert", "prep"]);
const mealStatus = z.enum([
  "planned",
  "completed",
  "changed",
  "deferred",
  "skipped",
  "open",
  "unconfirmed",
]);
const schemas = {
  inventory_entry: z.object({
    ingredient: z.string().trim().min(1).max(200),
    brandVariety: nullableText,
    category: z.string().trim().min(1).max(100),
    quantity: nullableNumber,
    unit: nullableText,
    locationName: z.string().trim().min(1).max(200),
    storageDetail: nullableText,
    packageState: z.enum(["sealed", "opened", "full", "partial", "nearly_empty", "unknown"]),
    bestBefore: optionalDate,
    priority: z.enum(["normal", "use_soon", "use_now", "reserved"]),
    notes: nullableText,
    verifiedAt: optionalDate,
  }),
  food_preference: z.object({
    person,
    topic: z.string().trim().min(1).max(300),
    classification: z.string().trim().min(1).max(100),
    detail: z.string().trim().min(1).max(2000),
    context: nullableText,
    status: z.enum(["active", "contextual", "superseded"]),
    effectiveDate: optionalDate,
  }),
  meal_feedback: z.object({
    feedbackDate: z.string().date(),
    dish: z.string().trim().min(1).max(300),
    mealType,
    recipeUrl,
    recipeNote: nullableText,
    person,
    rating: z.enum(["Love", "Like", "Mixed", "Dislike"]),
    feedback: z.string().trim().min(1).max(2000),
    nextTimeChanges: nullableText,
    repeatDecision: nullableText,
  }),
  staple_target: z.object({
    ingredient: z.string().trim().min(1).max(200),
    category: nullableText,
    targetMinimum: nullableNumber,
    unit: nullableText,
    preferredBrand: nullableText,
    currentStatus: nullableText,
    reorderRule: nullableText,
    notes: nullableText,
    reviewedAt: optionalDate,
  }),
  shopping_item: z.object({
    item: z.string().trim().min(1).max(200),
    category: nullableText,
    quantity: nullableNumber,
    unit: nullableText,
    status: z.enum(["to_buy", "purchased", "deferred", "removed"]),
    notes: nullableText,
    dateAdded: optionalDate,
  }),
  meal_plan_entry: z.object({
    mealDate: z.string().date(),
    mealType,
    assignedPerson: person,
    dish: z.string().trim().min(1).max(300),
    recipeUrl,
    recipeNote: nullableText,
    plannedYield: nullableText,
    packedLunch: z.boolean().nullable(),
    leftoverPrepLink: nullableText,
    status: mealStatus,
    notes: nullableText,
  }),
  unscheduled_item: z.object({
    weekStart: z.string().date(),
    itemType: mealType,
    assignedPerson: person,
    title: z.string().trim().min(1).max(300),
    recipeUrl,
    recipeNote: nullableText,
    plannedYield: nullableText,
    status: mealStatus,
    notes: nullableText,
  }),
};

const destinationTables = {
  inventory_entry: "inventory_entries",
  food_preference: "food_preferences",
  meal_feedback: "meal_feedback",
  staple_target: "staple_targets",
  shopping_item: "shopping_items",
  meal_plan_entry: "meal_plan_entries",
  unscheduled_item: "unscheduled_items",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function counts(client, householdId) {
  const result = await client.query(
    `SELECT
    (SELECT count(*)::int FROM inventory_entries WHERE household_id=$1 AND archived_at IS NULL) AS inventory,
    (SELECT count(*)::int FROM food_preferences WHERE household_id=$1) AS preferences,
    (SELECT count(*)::int FROM meal_feedback WHERE household_id=$1) AS feedback,
    (SELECT count(*)::int FROM staple_targets WHERE household_id=$1) AS staples,
    (SELECT count(*)::int FROM shopping_items WHERE household_id=$1 AND status<>'removed') AS shopping,
    (SELECT count(*)::int FROM meal_plan_entries WHERE household_id=$1) AS meals,
    (SELECT count(*)::int FROM unscheduled_items WHERE household_id=$1) AS unscheduled`,
    [householdId],
  );
  return result.rows[0];
}

async function userId(client, householdId, name) {
  if (!name) return null;
  const result = await client.query(
    "SELECT id FROM household_users WHERE household_id=$1 AND active=true AND lower(display_name)=lower($2) LIMIT 1",
    [householdId, name],
  );
  if (!result.rows[0])
    throw new Error(`Workbook person “${name}” is not an active household member`);
  return result.rows[0].id;
}

async function locationId(client, householdId, name, detail) {
  const existing = await client.query(
    "SELECT id FROM storage_locations WHERE household_id=$1 AND name=$2 AND detail IS NOT DISTINCT FROM $3 LIMIT 1",
    [householdId, name, detail],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await client.query(
    "INSERT INTO storage_locations (household_id,name,detail,sort_order) VALUES ($1,$2,$3,999) RETURNING id",
    [householdId, name, detail],
  );
  return created.rows[0].id;
}

async function recipeId(client, householdId, title, url, note, yieldText) {
  if (!url && !note) return null;
  const existing = await client.query(
    "SELECT id FROM recipes WHERE household_id=$1 AND lower(title)=lower($2) AND source_url IS NOT DISTINCT FROM $3 ORDER BY created_at LIMIT 1",
    [householdId, title, url],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await client.query(
    "INSERT INTO recipes (household_id,title,source_url,planned_yield,notes) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [householdId, title, url, yieldText, note],
  );
  return created.rows[0].id;
}

function legacy(batch, row) {
  return JSON.stringify({
    importBatchId: batch.id,
    sourceFilename: batch.source_filename,
    sourceChecksum: batch.source_checksum,
    sourceSheet: row.source_sheet,
    sourceRow: row.source_row,
  });
}

async function assertTarget(client, householdId, destination, targetId) {
  const table = destinationTables[destination];
  if (!table || !targetId) throw new Error("A supported existing target is required");
  const result = await client.query(`SELECT id FROM ${table} WHERE id=$1 AND household_id=$2`, [
    targetId,
    householdId,
  ]);
  if (!result.rows[0]) throw new Error(`Selected ${destination} target no longer exists`);
}

async function auditRow(
  client,
  batch,
  actorId,
  row,
  action,
  destination,
  entityId,
  beforeState,
  afterState,
) {
  await client.query(
    `INSERT INTO audit_events (household_id,actor_user_id,source,action,entity_type,entity_id,reason,before_state,after_state,idempotency_key)
    VALUES ($1,$2,'import',$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
    [
      batch.household_id,
      actorId,
      action,
      destination,
      entityId,
      `${row.source_sheet} row ${row.source_row}`,
      JSON.stringify(beforeState ?? null),
      JSON.stringify(afterState ?? null),
      `cutover:${batch.id}:row:${row.id}`,
    ],
  );
}

async function writeDestination(client, batch, row, destination, payload, targetId = null) {
  const householdId = batch.household_id;
  const source = legacy(batch, row);
  let result;
  if (destination === "inventory_entry") {
    const storage = await locationId(
      client,
      householdId,
      payload.locationName,
      payload.storageDetail,
    );
    result = targetId
      ? await client.query(
          `UPDATE inventory_entries SET ingredient=$3,brand_variety=$4,category=$5,quantity=$6,unit=$7,storage_location_id=$8,storage_detail=$9,package_state=$10,best_before=$11,priority=$12,notes=$13,legacy_source=$14::jsonb,verified_at=$15,archived_at=NULL,updated_at=now() WHERE id=$1 AND household_id=$2 RETURNING id`,
          [
            targetId,
            householdId,
            payload.ingredient,
            payload.brandVariety,
            payload.category,
            payload.quantity,
            payload.unit,
            storage,
            payload.storageDetail,
            payload.packageState,
            payload.bestBefore,
            payload.priority,
            payload.notes,
            source,
            payload.verifiedAt,
          ],
        )
      : await client.query(
          `INSERT INTO inventory_entries (household_id,ingredient,brand_variety,category,quantity,unit,storage_location_id,storage_detail,package_state,best_before,priority,notes,legacy_source,verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14) RETURNING id`,
          [
            householdId,
            payload.ingredient,
            payload.brandVariety,
            payload.category,
            payload.quantity,
            payload.unit,
            storage,
            payload.storageDetail,
            payload.packageState,
            payload.bestBefore,
            payload.priority,
            payload.notes,
            source,
            payload.verifiedAt,
          ],
        );
  } else if (destination === "food_preference") {
    const member = await userId(client, householdId, payload.person);
    result = targetId
      ? await client.query(
          `UPDATE food_preferences SET user_id=$3,topic=$4,classification=$5,detail=$6,context=$7,status=$8,effective_date=COALESCE($9,current_date) WHERE id=$1 AND household_id=$2 RETURNING id`,
          [
            targetId,
            householdId,
            member,
            payload.topic,
            payload.classification,
            payload.detail,
            payload.context,
            payload.status,
            payload.effectiveDate,
          ],
        )
      : await client.query(
          `INSERT INTO food_preferences (household_id,user_id,topic,classification,detail,context,status,effective_date) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,current_date)) RETURNING id`,
          [
            householdId,
            member,
            payload.topic,
            payload.classification,
            payload.detail,
            payload.context,
            payload.status,
            payload.effectiveDate,
          ],
        );
  } else if (destination === "meal_feedback") {
    const member = await userId(client, householdId, payload.person);
    const recipe = await recipeId(
      client,
      householdId,
      payload.dish,
      payload.recipeUrl,
      payload.recipeNote,
      null,
    );
    result = targetId
      ? await client.query(
          `UPDATE meal_feedback SET user_id=$3,recipe_id=$4,feedback_date=$5,dish=$6,rating=$7,feedback=$8,next_time_changes=$9,repeat_decision=$10,legacy_source=$11::jsonb WHERE id=$1 AND household_id=$2 RETURNING id`,
          [
            targetId,
            householdId,
            member,
            recipe,
            payload.feedbackDate,
            payload.dish,
            payload.rating,
            payload.feedback,
            payload.nextTimeChanges,
            payload.repeatDecision,
            source,
          ],
        )
      : await client.query(
          `INSERT INTO meal_feedback (household_id,user_id,recipe_id,feedback_date,dish,rating,feedback,next_time_changes,repeat_decision,legacy_source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING id`,
          [
            householdId,
            member,
            recipe,
            payload.feedbackDate,
            payload.dish,
            payload.rating,
            payload.feedback,
            payload.nextTimeChanges,
            payload.repeatDecision,
            source,
          ],
        );
  } else if (destination === "staple_target") {
    result = targetId
      ? await client.query(
          `UPDATE staple_targets SET ingredient=$3,category=$4,target_minimum=$5,unit=$6,preferred_brand=$7,current_status=$8,reorder_rule=$9,notes=$10,reviewed_at=$11 WHERE id=$1 AND household_id=$2 RETURNING id`,
          [
            targetId,
            householdId,
            payload.ingredient,
            payload.category,
            payload.targetMinimum,
            payload.unit,
            payload.preferredBrand,
            payload.currentStatus,
            payload.reorderRule,
            payload.notes,
            payload.reviewedAt,
          ],
        )
      : await client.query(
          `INSERT INTO staple_targets (household_id,ingredient,category,target_minimum,unit,preferred_brand,current_status,reorder_rule,notes,reviewed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            householdId,
            payload.ingredient,
            payload.category,
            payload.targetMinimum,
            payload.unit,
            payload.preferredBrand,
            payload.currentStatus,
            payload.reorderRule,
            payload.notes,
            payload.reviewedAt,
          ],
        );
  } else if (destination === "shopping_item") {
    result = targetId
      ? await client.query(
          `UPDATE shopping_items SET item=$3,category=$4,quantity=$5,unit=$6,status=$7,notes=$8,created_at=COALESCE($9::date,created_at),updated_at=now() WHERE id=$1 AND household_id=$2 RETURNING id`,
          [
            targetId,
            householdId,
            payload.item,
            payload.category,
            payload.quantity,
            payload.unit,
            payload.status,
            payload.notes,
            payload.dateAdded,
          ],
        )
      : await client.query(
          `INSERT INTO shopping_items (household_id,item,category,quantity,unit,status,notes,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date,now())) RETURNING id`,
          [
            householdId,
            payload.item,
            payload.category,
            payload.quantity,
            payload.unit,
            payload.status,
            payload.notes,
            payload.dateAdded,
          ],
        );
  } else if (destination === "meal_plan_entry") {
    const member = await userId(client, householdId, payload.assignedPerson);
    const recipe = await recipeId(
      client,
      householdId,
      payload.dish,
      payload.recipeUrl,
      payload.recipeNote,
      payload.plannedYield,
    );
    result = targetId
      ? await client.query(
          `UPDATE meal_plan_entries SET meal_date=$3,meal_type=$4,assigned_user_id=$5,dish=$6,recipe_id=$7,planned_yield=$8,packed_lunch=$9,leftover_prep_link=$10,status=$11,notes=$12,legacy_source=$13::jsonb,updated_at=now() WHERE id=$1 AND household_id=$2 RETURNING id`,
          [
            targetId,
            householdId,
            payload.mealDate,
            payload.mealType,
            member,
            payload.dish,
            recipe,
            payload.plannedYield,
            payload.packedLunch,
            payload.leftoverPrepLink,
            payload.status,
            payload.notes,
            source,
          ],
        )
      : await client.query(
          `INSERT INTO meal_plan_entries (household_id,meal_date,meal_type,assigned_user_id,dish,recipe_id,planned_yield,packed_lunch,leftover_prep_link,status,notes,legacy_source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING id`,
          [
            householdId,
            payload.mealDate,
            payload.mealType,
            member,
            payload.dish,
            recipe,
            payload.plannedYield,
            payload.packedLunch,
            payload.leftoverPrepLink,
            payload.status,
            payload.notes,
            source,
          ],
        );
  } else if (destination === "unscheduled_item") {
    const member = await userId(client, householdId, payload.assignedPerson);
    const recipe = await recipeId(
      client,
      householdId,
      payload.title,
      payload.recipeUrl,
      payload.recipeNote,
      payload.plannedYield,
    );
    result = targetId
      ? await client.query(
          `UPDATE unscheduled_items SET week_start=$3,item_type=$4,assigned_user_id=$5,title=$6,recipe_id=$7,planned_yield=$8,status=$9,notes=$10,legacy_source=$11::jsonb,updated_at=now() WHERE id=$1 AND household_id=$2 RETURNING id`,
          [
            targetId,
            householdId,
            payload.weekStart,
            payload.itemType,
            member,
            payload.title,
            recipe,
            payload.plannedYield,
            payload.status,
            payload.notes,
            source,
          ],
        )
      : await client.query(
          `INSERT INTO unscheduled_items (household_id,week_start,item_type,assigned_user_id,title,recipe_id,planned_yield,status,notes,legacy_source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING id`,
          [
            householdId,
            payload.weekStart,
            payload.itemType,
            member,
            payload.title,
            recipe,
            payload.plannedYield,
            payload.status,
            payload.notes,
            source,
          ],
        );
  } else throw new Error(`Unsupported import destination: ${destination}`);
  if (!result.rows[0]) throw new Error(`Could not write ${destination}`);
  return result.rows[0].id;
}

export async function commitImportBatch(client, { batchId, confirmation, backupReference }) {
  if (confirmation !== "COMMIT") throw new Error("Cutover confirmation must be COMMIT");
  if (!uuid.test(batchId)) throw new Error("Batch id is not a UUID");
  if (!backupReference) throw new Error("A fresh backup reference is required");
  await client.query("BEGIN");
  try {
    const batchResult = await client.query("SELECT * FROM import_batches WHERE id=$1 FOR UPDATE", [
      batchId,
    ]);
    const batch = batchResult.rows[0];
    if (!batch) throw new Error("Import batch was not found");
    if (batch.status === "committed" || batch.committed_at)
      throw new Error("Import batch has already been committed");
    const unresolved = await client.query(
      "SELECT count(*)::int AS count FROM import_rows WHERE batch_id=$1 AND requires_reconciliation=true AND resolved_at IS NULL",
      [batchId],
    );
    if (unresolved.rows[0].count)
      throw new Error(
        `${unresolved.rows[0].count} reconciliation decision(s) are still unresolved`,
      );
    const owner = await client.query(
      "SELECT id FROM household_users WHERE household_id=$1 AND role='owner' AND active=true ORDER BY created_at LIMIT 1",
      [batch.household_id],
    );
    if (!owner.rows[0]) throw new Error("An active household owner is required");
    const actorId = owner.rows[0].id;
    const previous = await client.query(
      "SELECT 1 FROM cutover_runs WHERE batch_id=$1 AND status='committed'",
      [batchId],
    );
    if (previous.rows[0]) throw new Error("A committed cutover already exists for this batch");
    const before = await counts(client, batch.household_id);
    const run = await client.query(
      "INSERT INTO cutover_runs (household_id,batch_id,actor_user_id,status,backup_reference,before_counts) VALUES ($1,$2,$3,'running',$4,$5::jsonb) RETURNING id",
      [batch.household_id, batchId, actorId, backupReference, JSON.stringify(before)],
    );

    const removed = {};
    removed.inventory = (
      await client.query(
        "DELETE FROM inventory_entries WHERE household_id=$1 AND notes LIKE '%Synthetic Phase 3 fixture%' RETURNING id",
        [batch.household_id],
      )
    ).rowCount;
    removed.shopping = (
      await client.query(
        "DELETE FROM shopping_items WHERE household_id=$1 AND notes='Synthetic fixture' RETURNING id",
        [batch.household_id],
      )
    ).rowCount;
    removed.meals = (
      await client.query(
        "DELETE FROM meal_plan_entries WHERE household_id=$1 AND notes='Synthetic fixture' RETURNING id",
        [batch.household_id],
      )
    ).rowCount;
    removed.unscheduled = (
      await client.query(
        "DELETE FROM unscheduled_items WHERE household_id=$1 AND notes='Synthetic fixture' RETURNING id",
        [batch.household_id],
      )
    ).rowCount;

    const staged = await client.query(
      "SELECT * FROM import_rows WHERE batch_id=$1 ORDER BY source_sheet,source_row FOR UPDATE",
      [batchId],
    );
    const actions = {};
    const destinations = {};
    for (const row of staged.rows) {
      const action = row.requires_reconciliation ? row.resolution_action : "import";
      if (!action)
        throw new Error(`${row.source_sheet} row ${row.source_row} has no resolution action`);
      actions[action] = (actions[action] ?? 0) + 1;
      if (action === "skip") {
        await client.query(
          "UPDATE import_rows SET status='committed',committed_entity_type='skipped',committed_entity_id=NULL WHERE id=$1",
          [row.id],
        );
        continue;
      }
      const destination = row.destination_type;
      if (!schemas[destination])
        throw new Error(`${row.source_sheet} row ${row.source_row} has no supported destination`);
      if (action === "import_unscheduled" && destination !== "unscheduled_item")
        throw new Error(
          `${row.source_sheet} row ${row.source_row} cannot be imported as unscheduled`,
        );
      if (action === "use_existing") {
        await assertTarget(client, batch.household_id, destination, row.resolution_target_id);
        await client.query(
          "UPDATE import_rows SET status='committed',committed_entity_type=$2,committed_entity_id=$3 WHERE id=$1",
          [row.id, destination, row.resolution_target_id],
        );
        await auditRow(
          client,
          batch,
          actorId,
          row,
          "map_existing",
          destination,
          row.resolution_target_id,
          null,
          { sourceRowMapped: true },
        );
        destinations[destination] = (destinations[destination] ?? 0) + 1;
        continue;
      }
      const rawPayload = row.requires_reconciliation
        ? (row.resolution_payload ?? row.normalized_payload)
        : row.normalized_payload;
      const payload = schemas[destination].parse(rawPayload);
      let targetId = null;
      let beforeTarget = null;
      if (action === "replace_existing") {
        targetId = row.resolution_target_id;
        await assertTarget(client, batch.household_id, destination, targetId);
        const table = destinationTables[destination];
        beforeTarget =
          (
            await client.query(
              `SELECT to_jsonb(t) AS state FROM ${table} t WHERE id=$1 AND household_id=$2`,
              [targetId, batch.household_id],
            )
          ).rows[0]?.state ?? null;
      } else if (action !== "import" && action !== "import_unscheduled")
        throw new Error(`Unsupported resolution action: ${action}`);
      const entityId = await writeDestination(client, batch, row, destination, payload, targetId);
      await client.query(
        "UPDATE import_rows SET status='committed',committed_entity_type=$2,committed_entity_id=$3 WHERE id=$1",
        [row.id, destination, entityId],
      );
      await auditRow(
        client,
        batch,
        actorId,
        row,
        targetId ? "replace" : "import",
        destination,
        entityId,
        beforeTarget,
        payload,
      );
      destinations[destination] = (destinations[destination] ?? 0) + 1;
    }
    const after = await counts(client, batch.household_id);
    const resultCounts = { actions, destinations, removedSynthetic: removed, before, after };
    await client.query(
      "UPDATE import_batches SET dry_run=false,status='committed',resolved_rows=reconciliation_rows,committed_by=$2,committed_at=now(),completed_at=now() WHERE id=$1",
      [batchId, actorId],
    );
    await client.query(
      `INSERT INTO app_settings (household_id,key,value) VALUES ($1,'canonical_data',$2::jsonb)
      ON CONFLICT (household_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
      [
        batch.household_id,
        JSON.stringify({
          source: "PostgreSQL",
          batchId,
          sourceFilename: batch.source_filename,
          sourceChecksum: batch.source_checksum,
          cutoverAt: new Date().toISOString(),
          backupReference,
        }),
      ],
    );
    await client.query(
      "UPDATE cutover_runs SET status='committed',result_counts=$2::jsonb,completed_at=now() WHERE id=$1",
      [run.rows[0].id, JSON.stringify(resultCounts)],
    );
    await client.query(
      `INSERT INTO audit_events (household_id,actor_user_id,source,action,entity_type,entity_id,reason,before_state,after_state,idempotency_key)
      VALUES ($1,$2,'import','cutover','import_batch',$3,'Backup-gated transactional workbook cutover',$4::jsonb,$5::jsonb,$6)`,
      [
        batch.household_id,
        actorId,
        batchId,
        JSON.stringify(before),
        JSON.stringify(resultCounts),
        `cutover:${batchId}`,
      ],
    );
    await client.query("COMMIT");
    return { batchId, runId: run.rows[0].id, backupReference, ...resultCounts };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
