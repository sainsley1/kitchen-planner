import type { StagedWorkbookRow } from "./workbook-preview";

export const importDestinations = [
  "inventory_entry",
  "food_preference",
  "meal_feedback",
  "staple_target",
  "shopping_item",
  "meal_plan_entry",
  "unscheduled_item",
] as const;

export type ImportDestination = (typeof importDestinations)[number];
export type ImportAction =
  | "import"
  | "skip"
  | "import_unscheduled"
  | "use_existing"
  | "replace_existing";
export type NormalizedImportRow = Omit<StagedWorkbookRow, "normalized"> & {
  destinationType: ImportDestination | null;
  normalized: Record<string, unknown> | null;
  requiresReconciliation: boolean;
  suggestedAction: ImportAction;
};

const text = (value: string | null | undefined) => value?.trim() || null;
const number = (value: string | null | undefined) => {
  if (!text(value)) return null;
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const keyText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-CA")
    .replaceAll(/\s+/g, " ");

function token(value: string | null | undefined) {
  return keyText(value)
    .replaceAll(/[–—-]/g, "_")
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_|_$/g, "");
}

function mapped<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fallback: T,
  field: string,
  messages: string[],
): T {
  const candidate = token(value) as T;
  if (!candidate) return fallback;
  if (allowed.includes(candidate)) return candidate;
  messages.push(`${field} “${value}” is not recognized; review the suggested value “${fallback}”.`);
  return fallback;
}

function person(value: string | null | undefined) {
  const result = text(value);
  return !result || keyText(result) === "household" ? null : result;
}

function yesNo(value: string | null | undefined): boolean | null {
  const candidate = token(value);
  if (candidate === "yes" || candidate === "true") return true;
  if (candidate === "no" || candidate === "false") return false;
  return null;
}

function recipe(value: string | null | undefined) {
  const candidate = text(value);
  return candidate && /^https?:\/\//i.test(candidate) ? candidate : null;
}

function notes(...values: Array<string | null | undefined>) {
  const kept = values.map(text).filter((value): value is string => Boolean(value));
  return kept.length ? kept.join(" — ") : null;
}

export function normalizeWorkbookRow(row: StagedWorkbookRow): NormalizedImportRow {
  const raw = row.raw;
  const messages = [...row.messages];
  let destinationType: ImportDestination | null = null;
  let normalized: Record<string, unknown> | null = null;

  if (row.sheet === "Current Inventory") {
    destinationType = "inventory_entry";
    normalized = {
      ingredient: text(raw.Ingredient),
      brandVariety: text(raw["Brand / Variety"]),
      category: text(raw.Category),
      quantity: number(raw.Quantity),
      unit: text(raw.Unit),
      locationName: text(raw.Location),
      storageDetail: text(raw["Storage Detail"]),
      packageState: mapped(
        raw["Package State"],
        ["sealed", "opened", "full", "partial", "nearly_empty", "unknown"],
        "unknown",
        "Package state",
        messages,
      ),
      bestBefore: text(raw["Best Before"]),
      priority: mapped(
        raw.Priority,
        ["normal", "use_soon", "use_now", "reserved"],
        "normal",
        "Priority",
        messages,
      ),
      notes: text(raw.Notes),
      verifiedAt: text(raw["Last Verified"]),
    };
  } else if (row.sheet === "Food Profile") {
    destinationType = "food_preference";
    normalized = {
      person: person(raw.Person),
      topic: text(raw["Food / Dish / Rule"]),
      classification: text(raw.Classification),
      detail: text(raw.Details) ?? text(raw["Food / Dish / Rule"]),
      context: text(raw.Context),
      status: mapped(
        raw["Record Status"],
        ["active", "contextual", "superseded"],
        "active",
        "Record status",
        messages,
      ),
      effectiveDate: text(raw["Effective Date"]),
    };
  } else if (row.sheet === "Meal Feedback") {
    destinationType = "meal_feedback";
    normalized = {
      feedbackDate: text(raw.Date),
      dish: text(raw.Dish),
      mealType: mapped(
        raw["Meal Type"],
        ["breakfast", "lunch", "dinner", "snack", "dessert", "prep"],
        "dinner",
        "Meal type",
        messages,
      ),
      recipeUrl: recipe(raw["Recipe URL"]),
      recipeNote: recipe(raw["Recipe URL"]) ? null : text(raw["Recipe URL"]),
      person: person(raw.Person),
      rating: text(raw.Rating),
      feedback: text(raw.Feedback) ?? text(raw.Rating),
      nextTimeChanges: text(raw["Next-Time Changes"]),
      repeatDecision: text(raw["Repeat Decision"]),
    };
  } else if (row.sheet === "Staples") {
    destinationType = "staple_target";
    normalized = {
      ingredient: text(raw.Ingredient),
      category: text(raw.Category),
      targetMinimum: number(raw["Target Minimum"]),
      unit: text(raw.Unit),
      preferredBrand: text(raw["Preferred Brand"]),
      currentStatus: text(raw["Current Status"]),
      reorderRule: text(raw["Reorder Rule"]),
      notes: text(raw.Notes),
      reviewedAt: text(raw["Last Reviewed"]),
    };
  } else if (row.sheet === "Shopping List") {
    destinationType = "shopping_item";
    normalized = {
      item: text(raw.Item),
      category: text(raw.Category),
      quantity: number(raw.Quantity),
      unit: text(raw.Unit),
      status: mapped(
        raw.Status,
        ["to_buy", "purchased", "deferred", "removed"],
        "to_buy",
        "Shopping status",
        messages,
      ),
      notes: text(raw.Notes),
      dateAdded: text(raw["Date Added"]),
    };
  } else if (row.sheet === "Meal Plan Data") {
    const common = {
      person: person(raw.Person),
      itemType: mapped(
        raw.Meal,
        ["breakfast", "lunch", "dinner", "snack", "dessert", "prep"],
        "prep",
        "Meal type",
        messages,
      ),
      title: text(raw.Dish),
      recipeUrl: recipe(raw["Recipe URL"]),
      recipeNote: recipe(raw["Recipe URL"]) ? null : text(raw["Recipe URL"]),
      plannedYield: text(raw["Planned Yield"]),
      status: mapped(
        raw.Status,
        ["planned", "completed", "changed", "deferred", "skipped", "open", "unconfirmed"],
        "planned",
        "Meal status",
        messages,
      ),
      notes: text(raw.Notes),
      prepLink: text(raw["Leftover / Prep Link"]),
    };
    if (text(raw.Date)) {
      destinationType = "meal_plan_entry";
      normalized = {
        mealDate: text(raw.Date),
        mealType: common.itemType,
        assignedPerson: common.person,
        dish: common.title,
        recipeUrl: common.recipeUrl,
        recipeNote: common.recipeNote,
        plannedYield: common.plannedYield,
        packedLunch: yesNo(raw["Packed Lunch?"]),
        leftoverPrepLink: common.prepLink,
        status: common.status,
        notes: common.notes,
      };
    } else {
      destinationType = "unscheduled_item";
      normalized = {
        weekStart: text(raw["Week Start"]),
        itemType: common.itemType,
        assignedPerson: common.person,
        title: common.title,
        recipeUrl: common.recipeUrl,
        recipeNote: common.recipeNote,
        plannedYield: common.plannedYield,
        status: common.status,
        notes: notes(common.notes, common.prepLink),
      };
      if (!normalized.weekStart)
        messages.push("A week start is required before this can become an Unscheduled item.");
    }
  }

  const status =
    row.status === "rejected" ||
    messages.some(
      (message) => message.startsWith("Missing required") || message.startsWith("A week start"),
    )
      ? "rejected"
      : messages.length
        ? "warning"
        : "valid";
  const requiresReconciliation = status !== "valid" || destinationType == null;
  const suggestedAction: ImportAction =
    destinationType === "unscheduled_item"
      ? "import_unscheduled"
      : status === "rejected"
        ? "skip"
        : "import";
  return {
    ...row,
    status,
    messages,
    normalized,
    destinationType,
    requiresReconciliation,
    suggestedAction,
  };
}

export function importDedupeKey(
  destination: ImportDestination,
  payload: Record<string, unknown>,
): string {
  const parts: unknown[] =
    destination === "inventory_entry"
      ? [payload.ingredient, payload.brandVariety, payload.locationName, payload.storageDetail]
      : destination === "food_preference"
        ? [payload.person, payload.topic, payload.classification, payload.detail]
        : destination === "meal_feedback"
          ? [payload.feedbackDate, payload.person, payload.dish]
          : destination === "staple_target"
            ? [payload.ingredient]
            : destination === "shopping_item"
              ? [payload.item]
              : destination === "meal_plan_entry"
                ? [payload.mealDate, payload.mealType, payload.assignedPerson, payload.dish]
                : [payload.weekStart, payload.itemType, payload.assignedPerson, payload.title];
  return `${destination}:${parts.map(keyText).join("|")}`;
}
