import type { PoolClient } from "pg";
import { importDedupeKey, type NormalizedImportRow } from "./workbook-normalize";

export type DuplicateCandidate = {
  id: string | null;
  label: string;
  kind: "database" | "workbook";
  synthetic: boolean;
};

type ExistingRecord = {
  id: string;
  destination: NormalizedImportRow["destinationType"];
  payload: Record<string, unknown>;
  label: string;
  synthetic?: boolean;
};

async function loadExisting(client: PoolClient, householdId: string): Promise<ExistingRecord[]> {
  const [inventory, preferences, feedback, staples, shopping, meals, unscheduled] =
    await Promise.all([
      client.query(
        `SELECT i.id,i.ingredient,i.brand_variety,l.name AS location_name,COALESCE(i.storage_detail,l.detail) AS storage_detail,i.notes
      FROM inventory_entries i LEFT JOIN storage_locations l ON l.id=i.storage_location_id WHERE i.household_id=$1 AND i.archived_at IS NULL`,
        [householdId],
      ),
      client.query(
        `SELECT f.id,u.display_name AS person,f.topic,f.classification,f.detail FROM food_preferences f LEFT JOIN household_users u ON u.id=f.user_id WHERE f.household_id=$1`,
        [householdId],
      ),
      client.query(
        `SELECT f.id,f.feedback_date::text AS feedback_date,u.display_name AS person,f.dish FROM meal_feedback f LEFT JOIN household_users u ON u.id=f.user_id WHERE f.household_id=$1`,
        [householdId],
      ),
      client.query(`SELECT id,ingredient FROM staple_targets WHERE household_id=$1`, [householdId]),
      client.query(
        `SELECT id,item,notes FROM shopping_items WHERE household_id=$1 AND status<>'removed'`,
        [householdId],
      ),
      client.query(
        `SELECT m.id,m.meal_date::text AS meal_date,m.meal_type,u.display_name AS person,m.dish,m.notes FROM meal_plan_entries m LEFT JOIN household_users u ON u.id=m.assigned_user_id WHERE m.household_id=$1`,
        [householdId],
      ),
      client.query(
        `SELECT x.id,x.week_start::text AS week_start,x.item_type,u.display_name AS person,x.title,x.notes FROM unscheduled_items x LEFT JOIN household_users u ON u.id=x.assigned_user_id WHERE x.household_id=$1`,
        [householdId],
      ),
    ]);

  return [
    ...inventory.rows.map((row) => ({
      id: row.id,
      destination: "inventory_entry" as const,
      payload: {
        ingredient: row.ingredient,
        brandVariety: row.brand_variety,
        locationName: row.location_name,
        storageDetail: row.storage_detail,
      },
      label: `${row.ingredient} · ${row.location_name ?? "No location"}${row.storage_detail ? ` / ${row.storage_detail}` : ""}`,
      synthetic: String(row.notes ?? "").includes("Synthetic Phase 3 fixture"),
    })),
    ...preferences.rows.map((row) => ({
      id: row.id,
      destination: "food_preference" as const,
      payload: {
        person: row.person,
        topic: row.topic,
        classification: row.classification,
        detail: row.detail,
      },
      label: `${row.person ?? "Household"} · ${row.topic}`,
    })),
    ...feedback.rows.map((row) => ({
      id: row.id,
      destination: "meal_feedback" as const,
      payload: { feedbackDate: row.feedback_date, person: row.person, dish: row.dish },
      label: `${row.feedback_date} · ${row.person ?? "Household"} · ${row.dish}`,
    })),
    ...staples.rows.map((row) => ({
      id: row.id,
      destination: "staple_target" as const,
      payload: { ingredient: row.ingredient },
      label: row.ingredient,
    })),
    ...shopping.rows.map((row) => ({
      id: row.id,
      destination: "shopping_item" as const,
      payload: { item: row.item },
      label: row.item,
      synthetic: String(row.notes ?? "") === "Synthetic fixture",
    })),
    ...meals.rows.map((row) => ({
      id: row.id,
      destination: "meal_plan_entry" as const,
      payload: {
        mealDate: row.meal_date,
        mealType: row.meal_type,
        assignedPerson: row.person,
        dish: row.dish,
      },
      label: `${row.meal_date} · ${row.meal_type} · ${row.person ?? "Household"} · ${row.dish}`,
      synthetic: String(row.notes ?? "") === "Synthetic fixture",
    })),
    ...unscheduled.rows.map((row) => ({
      id: row.id,
      destination: "unscheduled_item" as const,
      payload: {
        weekStart: row.week_start,
        itemType: row.item_type,
        assignedPerson: row.person,
        title: row.title,
      },
      label: `Week ${row.week_start} · ${row.title}`,
      synthetic: String(row.notes ?? "") === "Synthetic fixture",
    })),
  ];
}

export async function enrichImportReconciliation(
  client: PoolClient,
  householdId: string,
  rows: NormalizedImportRow[],
) {
  const existing = await loadExisting(client, householdId);
  const existingByKey = new Map<string, DuplicateCandidate[]>();
  for (const record of existing) {
    if (!record.destination) continue;
    const key = importDedupeKey(record.destination, record.payload);
    const candidate: DuplicateCandidate = {
      id: record.id,
      label: record.label,
      kind: "database",
      synthetic: Boolean(record.synthetic),
    };
    existingByKey.set(key, [...(existingByKey.get(key) ?? []), candidate]);
  }

  const workbookByKey = new Map<string, Array<{ sheet: string; row: number }>>();
  for (const row of rows) {
    if (!row.destinationType || !row.normalized) continue;
    const key = importDedupeKey(row.destinationType, row.normalized);
    workbookByKey.set(key, [...(workbookByKey.get(key) ?? []), { sheet: row.sheet, row: row.row }]);
  }

  return rows.map((row) => {
    if (!row.destinationType || !row.normalized)
      return { ...row, duplicateCandidates: [] as DuplicateCandidate[] };
    const key = importDedupeKey(row.destinationType, row.normalized);
    const databaseCandidates = existingByKey.get(key) ?? [];
    const workbookCandidates: DuplicateCandidate[] = (workbookByKey.get(key) ?? [])
      .filter((candidate) => candidate.sheet !== row.sheet || candidate.row !== row.row)
      .map((candidate) => ({
        id: null,
        label: `${candidate.sheet} · row ${candidate.row}`,
        kind: "workbook",
        synthetic: false,
      }));
    const duplicateCandidates = [...databaseCandidates, ...workbookCandidates];
    if (!duplicateCandidates.length) return { ...row, duplicateCandidates };
    const messages = [
      ...row.messages,
      `Potential duplicate: ${duplicateCandidates.map((candidate) => candidate.label).join("; ")}`,
    ];
    const realDatabaseCandidate = databaseCandidates.find((candidate) => !candidate.synthetic);
    return {
      ...row,
      status: row.status === "rejected" ? ("rejected" as const) : ("warning" as const),
      messages,
      requiresReconciliation: true,
      suggestedAction: realDatabaseCandidate ? ("use_existing" as const) : row.suggestedAction,
      duplicateCandidates,
    };
  });
}
