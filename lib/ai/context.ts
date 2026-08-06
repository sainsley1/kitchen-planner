import "server-only";
import { poolOrThrow } from "@/lib/db/client";
import { inferDirectMealUse, type DirectMealUse } from "@/lib/ai/inventory-meal-capability";

export type QuickContext = {
  today: string;
  inventory: Array<{
    id: string;
    ingredient: string;
    brandVariety: string | null;
    category: string;
    quantity: string | null;
    unit: string | null;
    locationName: string | null;
    storageLocationId: string | null;
    storageDetail: string | null;
    packageState: string;
    priority: string;
    notes: string | null;
  }>;
  locations: Array<{ id: string; name: string; detail: string | null }>;
  shopping: Array<{
    id: string;
    item: string;
    category: string | null;
    quantity: string | null;
    unit: string | null;
    status: string;
    notes: string | null;
  }>;
};

const QUERY_STOP_WORDS = new Set([
  "a",
  "about",
  "and",
  "at",
  "brought",
  "from",
  "home",
  "i",
  "in",
  "into",
  "it",
  "my",
  "of",
  "on",
  "one",
  "put",
  "some",
  "the",
  "to",
  "was",
  "with",
]);
function searchTerms(text: string) {
  return [
    ...new Set(
      text
        .toLocaleLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter((term) => term.length > 1 && !QUERY_STOP_WORDS.has(term)),
    ),
  ];
}
function score(terms: string[], values: Array<string | null | undefined>) {
  const haystack = values.filter(Boolean).join(" ").toLocaleLowerCase().normalize("NFKD");
  return terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
}
function bestMatches<T>(
  items: T[],
  terms: string[],
  values: (item: T) => Array<string | null | undefined>,
  limit: number,
) {
  return items
    .map((item, index) => ({ item, index, score: score(terms, values(item)) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((candidate) => candidate.item);
}

/**
 * Keep routine updates inexpensive: matching is local and deterministic, while
 * returned IDs are still checked against the complete household context.
 */
export function compactQuickContext(text: string, context: QuickContext) {
  const terms = searchTerms(text);
  const inventory = bestMatches(
    context.inventory,
    terms,
    (item) => [item.ingredient, item.brandVariety, item.category, item.unit],
    12,
  ).map((item) => ({
    id: item.id,
    ingredient: item.ingredient,
    brandVariety: item.brandVariety,
    category: item.category,
    quantity: item.quantity,
    unit: item.unit,
    storageLocationId: item.storageLocationId,
    storageDetail: item.storageDetail,
    packageState: item.packageState,
    priority: item.priority,
  }));
  const shopping = bestMatches(
    context.shopping,
    terms,
    (item) => [item.item, item.category, item.unit],
    8,
  );
  const matchedLocations = bestMatches(
    context.locations,
    terms,
    (item) => [item.name, item.detail],
    20,
  );
  const locations = (matchedLocations.length ? matchedLocations : context.locations).slice(0, 20);
  return {
    today: context.today,
    inventory,
    locations,
    shopping,
    omitted: {
      inventory: context.inventory.length - inventory.length,
      shopping: context.shopping.length - shopping.length,
      locations: context.locations.length - locations.length,
    },
  };
}

export async function quickContext(householdId: string): Promise<QuickContext> {
  const [today, inventory, locations, shopping] = await Promise.all([
    poolOrThrow().query<{ today: string }>(
      "SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM households WHERE id=$1",
      [householdId],
    ),
    poolOrThrow().query<QuickContext["inventory"][number]>(
      `SELECT i.id,i.ingredient,i.brand_variety AS "brandVariety",i.category,i.quantity::text,i.unit,l.name AS "locationName",i.storage_location_id AS "storageLocationId",i.storage_detail AS "storageDetail",i.package_state AS "packageState",i.priority,i.notes FROM inventory_entries i LEFT JOIN storage_locations l ON l.id=i.storage_location_id WHERE i.household_id=$1 AND i.archived_at IS NULL ORDER BY lower(i.ingredient)`,
      [householdId],
    ),
    poolOrThrow().query<QuickContext["locations"][number]>(
      `SELECT id,name,detail FROM storage_locations WHERE household_id=$1 AND active=true ORDER BY sort_order,name,detail`,
      [householdId],
    ),
    poolOrThrow().query<QuickContext["shopping"][number]>(
      `SELECT id,item,category,quantity::text,unit,status,notes FROM shopping_items WHERE household_id=$1 AND status<>'removed' ORDER BY lower(item)`,
      [householdId],
    ),
  ]);
  return {
    today: today.rows[0].today,
    inventory: inventory.rows,
    locations: locations.rows,
    shopping: shopping.rows,
  };
}

export type FeedbackContext = {
  today: string;
  users: Array<{ id: string; displayName: string }>;
  recentFeedback: Array<Record<string, unknown>>;
  preferences: Array<Record<string, unknown>>;
};
export function compactFeedbackContext(text: string, context: FeedbackContext) {
  const terms = searchTerms(text);
  const relevantFeedback = bestMatches(
    context.recentFeedback,
    terms,
    (item) => [JSON.stringify(item)],
    12,
  );
  const relevantPreferences = bestMatches(
    context.preferences,
    terms,
    (item) => [JSON.stringify(item)],
    20,
  );
  const recentFeedback = relevantFeedback.length
    ? relevantFeedback
    : context.recentFeedback.slice(0, 6);
  const preferences = relevantPreferences.length
    ? relevantPreferences
    : context.preferences.slice(0, 10);
  return {
    today: context.today,
    users: context.users.slice(0, 20),
    recentFeedback,
    preferences,
    omitted: {
      users: Math.max(context.users.length - 20, 0),
      recentFeedback: context.recentFeedback.length - recentFeedback.length,
      preferences: context.preferences.length - preferences.length,
    },
  };
}
export async function feedbackContext(householdId: string): Promise<FeedbackContext> {
  const [today, users, feedback, preferences] = await Promise.all([
    poolOrThrow().query<{ today: string }>(
      "SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM households WHERE id=$1",
      [householdId],
    ),
    poolOrThrow().query<{ id: string; displayName: string }>(
      `SELECT id,display_name AS "displayName" FROM household_users WHERE household_id=$1 AND active=true ORDER BY display_name`,
      [householdId],
    ),
    poolOrThrow().query(
      `SELECT f.feedback_date::text AS "feedbackDate",f.dish,f.rating,f.feedback,f.next_time_changes AS "nextTimeChanges",f.repeat_decision AS "repeatDecision",u.display_name AS person FROM meal_feedback f LEFT JOIN household_users u ON u.id=f.user_id WHERE f.household_id=$1 ORDER BY f.feedback_date DESC,f.created_at DESC LIMIT 50`,
      [householdId],
    ),
    poolOrThrow().query(
      `SELECT p.topic,p.classification,p.detail,p.context,p.status,u.display_name AS person FROM food_preferences p LEFT JOIN household_users u ON u.id=p.user_id WHERE p.household_id=$1 AND p.status<>'superseded' ORDER BY p.effective_date DESC,p.created_at DESC LIMIT 200`,
      [householdId],
    ),
  ]);
  return {
    today: today.rows[0].today,
    users: users.rows,
    recentFeedback: feedback.rows,
    preferences: preferences.rows,
  };
}

export type GroceryContext = {
  shopping: Array<{
    id: string;
    item: string;
    category: string | null;
    quantity: string | null;
    unit: string | null;
    notes: string | null;
    inventoryEntryId: string | null;
  }>;
  inventory: Array<{
    id: string;
    ingredient: string;
    brandVariety: string | null;
    category: string;
    quantity: string | null;
    unit: string | null;
    storageLocationId: string | null;
    storageDetail: string | null;
    packageState: string;
    priority: string;
    locationName: string | null;
    archivedAt: string | null;
  }>;
  locations: Array<{ id: string; name: string; detail: string | null }>;
};

export function compactGroceryContext(context: GroceryContext) {
  const terms = searchTerms(
    context.shopping
      .map((item) => `${item.item} ${item.category ?? ""} ${item.unit ?? ""}`)
      .join(" "),
  );
  const limit = Math.min(Math.max(context.shopping.length * 3, 12), 100);
  const linkedIds = new Set(
    context.shopping.map((item) => item.inventoryEntryId).filter((id): id is string => Boolean(id)),
  );
  const linked = context.inventory.filter((item) => linkedIds.has(item.id));
  const matched = bestMatches(
    context.inventory.filter((item) => !linkedIds.has(item.id)),
    terms,
    (item) => [item.ingredient, item.brandVariety, item.category, item.unit],
    limit,
  );
  const inventory = [...linked, ...matched].slice(0, limit).map((item) => ({
    id: item.id,
    ingredient: item.ingredient,
    brandVariety: item.brandVariety,
    category: item.category,
    quantity: item.quantity,
    unit: item.unit,
    storageLocationId: item.storageLocationId,
    storageDetail: item.storageDetail,
    packageState: item.packageState,
    priority: item.priority,
    archived: Boolean(item.archivedAt),
  }));
  return {
    shopping: context.shopping.slice(0, 100),
    inventory,
    locations: context.locations.slice(0, 30),
    omitted: {
      inventory: context.inventory.length - inventory.length,
      locations: Math.max(context.locations.length - 30, 0),
    },
  };
}

export async function groceryContext(
  householdId: string,
  shoppingItemIds: string[],
): Promise<GroceryContext> {
  const [shopping, inventory, locations] = await Promise.all([
    poolOrThrow().query<GroceryContext["shopping"][number]>(
      `SELECT id,item,category,quantity::text,unit,notes,inventory_entry_id AS "inventoryEntryId" FROM shopping_items WHERE household_id=$1 AND id=ANY($2::uuid[]) AND status='purchased' ORDER BY lower(item)`,
      [householdId, shoppingItemIds],
    ),
    poolOrThrow().query<GroceryContext["inventory"][number]>(
      `SELECT i.id,i.ingredient,i.brand_variety AS "brandVariety",i.category,i.quantity::text,i.unit,i.storage_location_id AS "storageLocationId",i.storage_detail AS "storageDetail",i.package_state AS "packageState",i.priority,l.name AS "locationName",i.archived_at::text AS "archivedAt" FROM inventory_entries i LEFT JOIN storage_locations l ON l.id=i.storage_location_id WHERE i.household_id=$1 AND (i.archived_at IS NULL OR i.id IN (SELECT s.inventory_entry_id FROM shopping_items s WHERE s.household_id=$1 AND s.id=ANY($2::uuid[]) AND s.inventory_entry_id IS NOT NULL)) ORDER BY i.archived_at NULLS FIRST,lower(i.ingredient)`,
      [householdId, shoppingItemIds],
    ),
    poolOrThrow().query<GroceryContext["locations"][number]>(
      `SELECT id,name,detail FROM storage_locations WHERE household_id=$1 AND active=true ORDER BY sort_order,name,detail`,
      [householdId],
    ),
  ]);
  if (shopping.rows.length !== new Set(shoppingItemIds).size)
    throw new Error("One or more selected shopping items are no longer marked as purchased");
  return { shopping: shopping.rows, inventory: inventory.rows, locations: locations.rows };
}

export type PlanningContext = {
  today: string;
  timeZone: string;
  users: Array<{ id: string; displayName: string }>;
  inventory: Array<{
    id: string;
    ingredient: string;
    brandVariety: string | null;
    category: string;
    quantity: string | null;
    unit: string | null;
    packageState: string;
    priority: string;
    locationName: string | null;
    storageDetail: string | null;
    bestBefore: string | null;
    notes: string | null;
    directMealUse: DirectMealUse | null;
  }>;
  flavorAssets: Array<{
    id: string;
    ingredient: string;
    brandVariety: string | null;
    category: string;
    quantity: string | null;
    unit: string | null;
    locationName: string | null;
    notes: string | null;
  }>;
  preferences: Array<{
    userId: string | null;
    person: string | null;
    topic: string;
    classification: string;
    detail: string;
    context: string | null;
    status: string;
  }>;
  feedback: Array<{
    person: string | null;
    feedbackDate: string;
    dish: string;
    rating: string;
    feedback: string;
    nextTimeChanges: string | null;
    repeatDecision: string | null;
  }>;
  recentMeals: Array<{
    mealDate: string;
    mealType: string;
    person: string | null;
    dish: string;
    status: string;
    recipeTitle: string | null;
  }>;
  existingMeals: Array<{
    id: string;
    mealDate: string;
    mealType: string;
    assignedUserId: string | null;
    person: string | null;
    dish: string;
    plannedYield: string | null;
    packedLunch: boolean | null;
    status: string;
  }>;
  unscheduled: Array<{
    id: string;
    weekStart: string;
    itemType: string;
    assignedUserId: string | null;
    person: string | null;
    title: string;
    plannedYield: string | null;
    notes: string | null;
  }>;
  shopping: Array<{
    id: string;
    item: string;
    category: string | null;
    quantity: string | null;
    unit: string | null;
    status: string;
    notes: string | null;
  }>;
  recipes: Array<{
    id: string;
    title: string;
    sourceType: string;
    sourceUrl: string | null;
    description: string | null;
    cuisine: string | null;
    mealTypes: string[];
    plannedYield: string | null;
    servings: number | null;
    prepMinutes: number | null;
    cookMinutes: number | null;
    ingredients: Array<{
      item: string;
      quantity: number | null;
      unit: string | null;
      optional: boolean;
    }>;
    tags: string[];
    notes: string | null;
    favorite: boolean;
    recipeStatus: "proven" | "experimental";
    freezerFriendly: boolean;
    leftoverFriendly: boolean;
    packedLunchFriendly: boolean;
    feedbackCount: number;
  }>;
  activeSales: Array<{
    id: string;
    storeName: string;
    storeLocation: string | null;
    validFrom: string;
    validUntil: string;
    item: string;
    brand: string | null;
    category: string | null;
    packageSize: string | null;
    price: string;
    regularPrice: string | null;
    savingsAmount: string | null;
    discountPercent: string | null;
    pricingUnit: string | null;
    multiBuyQuantity: number | null;
    memberOnly: boolean;
    limitText: string | null;
    notes: string | null;
    prioritized: boolean;
    dealGrade?: string | null;
    normalizedUnitPrice?: string | null;
    normalizedUnitMeasure?: string | null;
    estimatedRegularPrice?: string | null;
    opportunityScore: number;
    opportunityReasons: string[];
  }>;
  saleOpportunitySummary: { eligibleCount: number; suppliedCount: number; priorityCount: number };
};

function normalizedWords(value: string | null | undefined) {
  return new Set(
    (value ?? "")
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
}
function overlap(left: Set<string>, right: Set<string>) {
  for (const word of left) if (right.has(word)) return true;
  return false;
}
function numeric(value: string | null) {
  const parsed = value == null ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function rankSaleOpportunities(
  sales: Array<
    Omit<PlanningContext["activeSales"][number], "opportunityScore" | "opportunityReasons">
  >,
  context: {
    inventory: PlanningContext["inventory"];
    preferences: PlanningContext["preferences"];
    recentMeals: PlanningContext["recentMeals"];
    flavorAssets: PlanningContext["flavorAssets"];
    startDate: string;
  },
) {
  const inventoryWords = normalizedWords(
    context.inventory
      .map((item) => `${item.ingredient} ${item.brandVariety ?? ""} ${item.category}`)
      .join(" "),
  );
  const negativePreference = (item: PlanningContext["preferences"][number]) =>
    item.classification === "hard_constraint" ||
    /\b(no|not|avoid|allerg(?:y|ic)|cannot|can['’]?t|don['’]?t|dislike|hate|never)\b/i.test(
      `${item.topic} ${item.detail} ${item.context ?? ""}`,
    );
  const preferenceWords = normalizedWords(
    context.preferences
      .filter((item) => !negativePreference(item))
      .map((item) => `${item.topic} ${item.detail} ${item.context ?? ""}`)
      .join(" "),
  );
  const constraintWords = normalizedWords(
    context.preferences
      .filter(negativePreference)
      .map((item) => `${item.topic} ${item.detail} ${item.context ?? ""}`)
      .join(" "),
  );
  const recentWords = normalizedWords(context.recentMeals.map((item) => item.dish).join(" "));
  const planStart = new Date(`${context.startDate}T00:00:00Z`).getTime();
  return sales
    .map((sale) => {
      const words = normalizedWords(
        `${sale.item} ${sale.brand ?? ""} ${sale.category ?? ""} ${sale.notes ?? ""}`,
      );
      const reasons: string[] = [];
      let score = 0;
      if (sale.prioritized) {
        score += 100;
        reasons.push("household priority");
      }
      if (sale.dealGrade === "A+") {
        score += 40;
        reasons.push("🔥 A+ all-time low steal");
      } else if (sale.dealGrade === "A") {
        score += 25;
        reasons.push("A grade great deal");
      } else if (sale.dealGrade === "B") {
        score += 15;
        reasons.push("B grade good value");
      } else if (sale.dealGrade === "F") {
        score -= 50;
        reasons.push("⚠️ F grade artificially inflated baseline");
      }
      if (sale.normalizedUnitPrice && sale.normalizedUnitMeasure) {
        reasons.push(
          `$${Number(sale.normalizedUnitPrice).toFixed(2)} / ${sale.normalizedUnitMeasure}`,
        );
      }
      const discount = numeric(sale.discountPercent);
      if (discount != null && discount > 0) {
        score += Math.min(discount / 2, 25);
        reasons.push(`${Number(discount.toFixed(1))}% advertised discount`);
      } else if (numeric(sale.savingsAmount)) {
        score += 4;
        reasons.push("advertised savings recorded");
      }
      if (overlap(words, constraintWords)) {
        score -= 100;
        reasons.push("potential household-constraint conflict");
      } else if (overlap(words, preferenceWords)) {
        score += 8;
        reasons.push("matches household preferences");
      }
      if (overlap(words, inventoryWords)) {
        score += 6;
        reasons.push("matches current inventory");
      }
      const flavorWords = normalizedWords(
        context.flavorAssets.map((asset) => asset.ingredient).join(" "),
      );
      if (overlap(words, flavorWords)) {
        score += 12;
        reasons.push("pairs with pantry flavor assets");
      }
      const produce = /produce|vegetable|fruit|herb/i.test(`${sale.category ?? ""} ${sale.item}`);
      if (!overlap(words, recentWords)) {
        score += produce ? 7 : 3;
        reasons.push(produce ? "novel produce opportunity" : "not prominent in recent meals");
      } else {
        score -= 4;
        reasons.push("recent-meal overlap");
      }
      if (produce && context.flavorAssets.length) {
        score += 3;
        reasons.push("flavour assets available for pairing");
      }
      const daysUntilExpiry = Math.round(
        (new Date(`${sale.validUntil}T00:00:00Z`).getTime() - planStart) / 86_400_000,
      );
      if (daysUntilExpiry >= 0 && daysUntilExpiry <= 3) {
        score += 2;
        reasons.push("expires early in planning window");
      }
      if ((sale.multiBuyQuantity ?? 1) > 2) {
        score -= 2;
        reasons.push("larger multi-buy");
      }
      return { ...sale, opportunityScore: Number(score.toFixed(2)), opportunityReasons: reasons };
    })
    .sort(
      (left, right) =>
        right.opportunityScore - left.opportunityScore ||
        Number(right.prioritized) - Number(left.prioritized) ||
        left.validUntil.localeCompare(right.validUntil) ||
        left.storeName.localeCompare(right.storeName) ||
        left.item.localeCompare(right.item),
    );
}

export async function planningContext(
  householdId: string,
  startDate: string,
  endDate: string,
): Promise<PlanningContext> {
  type InventoryRow = Omit<PlanningContext["inventory"][number], "directMealUse">;
  type SaleRow = Omit<
    PlanningContext["activeSales"][number],
    "opportunityScore" | "opportunityReasons"
  >;
  const [
    household,
    users,
    inventory,
    flavorAssets,
    preferences,
    feedback,
    recentMeals,
    existingMeals,
    unscheduled,
    shopping,
    recipes,
    activeSales,
  ] = await Promise.all([
    poolOrThrow().query<{ today: string; timeZone: string }>(
      `SELECT (now() AT TIME ZONE timezone)::date::text AS today,timezone AS "timeZone" FROM households WHERE id=$1`,
      [householdId],
    ),
    poolOrThrow().query<PlanningContext["users"][number]>(
      `SELECT id,display_name AS "displayName" FROM household_users WHERE household_id=$1 AND active=true ORDER BY display_name`,
      [householdId],
    ),
    poolOrThrow().query<InventoryRow>(
      `SELECT i.id,i.ingredient,i.brand_variety AS "brandVariety",i.category,i.quantity::text,i.unit,i.package_state AS "packageState",i.priority,l.name AS "locationName",i.storage_detail AS "storageDetail",i.best_before::text AS "bestBefore",substring(i.notes for 500) AS notes FROM inventory_entries i LEFT JOIN storage_locations l ON l.id=i.storage_location_id WHERE i.household_id=$1 AND i.archived_at IS NULL ORDER BY CASE i.priority WHEN 'use_now' THEN 0 WHEN 'use_soon' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,i.best_before NULLS LAST,lower(i.ingredient) LIMIT 300`,
      [householdId],
    ),
    poolOrThrow().query<InventoryRow>(
      `SELECT i.id,i.ingredient,i.brand_variety AS "brandVariety",i.category,i.quantity::text,i.unit,i.package_state AS "packageState",i.priority,l.name AS "locationName",i.storage_detail AS "storageDetail",i.best_before::text AS "bestBefore",substring(i.notes for 500) AS notes FROM inventory_entries i LEFT JOIN storage_locations l ON l.id=i.storage_location_id WHERE i.household_id=$1 AND i.archived_at IS NULL AND (lower(i.category)~'(sauce|condiment|spice|seasoning|oil|vinegar|paste|aromatic|herb)' OR lower(i.ingredient)~'(sauce|paste|oil|vinegar|miso|gochujang|harissa|tahini|mustard|chutney|sambal|garlic|ginger|shallot|scallion|cardamom|cinnamon)') ORDER BY CASE i.priority WHEN 'use_now' THEN 0 WHEN 'use_soon' THEN 1 ELSE 2 END,lower(i.category),lower(i.ingredient) LIMIT 100`,
      [householdId],
    ),
    poolOrThrow().query<PlanningContext["preferences"][number]>(
      `SELECT p.user_id AS "userId",u.display_name AS person,p.topic,p.classification,p.detail,p.context,p.status FROM food_preferences p LEFT JOIN household_users u ON u.id=p.user_id WHERE p.household_id=$1 AND p.status<>'superseded' ORDER BY CASE p.classification WHEN 'hard_constraint' THEN 0 WHEN 'strong_preference' THEN 1 ELSE 2 END,p.effective_date DESC LIMIT 150`,
      [householdId],
    ),
    poolOrThrow().query<PlanningContext["feedback"][number]>(
      `SELECT u.display_name AS person,f.feedback_date::text AS "feedbackDate",f.dish,f.rating,f.feedback,f.next_time_changes AS "nextTimeChanges",f.repeat_decision AS "repeatDecision" FROM meal_feedback f LEFT JOIN household_users u ON u.id=f.user_id WHERE f.household_id=$1 ORDER BY f.feedback_date DESC,f.created_at DESC LIMIT 60`,
      [householdId],
    ),
    poolOrThrow().query<PlanningContext["recentMeals"][number]>(
      `SELECT m.meal_date::text AS "mealDate",m.meal_type AS "mealType",u.display_name AS person,m.dish,m.status,r.title AS "recipeTitle" FROM meal_plan_entries m LEFT JOIN household_users u ON u.id=m.assigned_user_id LEFT JOIN recipes r ON r.id=m.recipe_id WHERE m.household_id=$1 AND m.meal_date>=($2::date-56) AND m.meal_date<$2::date AND m.meal_type IN ('breakfast','lunch','dinner') AND m.status IN ('planned','completed','changed') ORDER BY m.meal_date DESC,m.updated_at DESC LIMIT 250`,
      [householdId, startDate],
    ),
    poolOrThrow().query<PlanningContext["existingMeals"][number]>(
      `SELECT m.id,m.meal_date::text AS "mealDate",m.meal_type AS "mealType",m.assigned_user_id AS "assignedUserId",u.display_name AS person,m.dish,m.planned_yield AS "plannedYield",m.packed_lunch AS "packedLunch",m.status FROM meal_plan_entries m LEFT JOIN household_users u ON u.id=m.assigned_user_id WHERE m.household_id=$1 AND m.archived_at IS NULL AND m.status='planned' AND m.meal_date BETWEEN $2::date AND $3::date ORDER BY m.meal_date,m.meal_type,u.display_name`,
      [householdId, startDate, endDate],
    ),
    poolOrThrow().query<PlanningContext["unscheduled"][number]>(
      `SELECT x.id,x.week_start::text AS "weekStart",x.item_type AS "itemType",x.assigned_user_id AS "assignedUserId",u.display_name AS person,x.title,x.planned_yield AS "plannedYield",x.notes FROM unscheduled_items x LEFT JOIN household_users u ON u.id=x.assigned_user_id WHERE x.household_id=$1 AND x.status IN ('planned','open','unconfirmed') AND x.week_start BETWEEN ($2::date-7) AND $3::date ORDER BY x.week_start,x.item_type,lower(x.title) LIMIT 100`,
      [householdId, startDate, endDate],
    ),
    poolOrThrow().query<PlanningContext["shopping"][number]>(
      `SELECT id,item,category,quantity::text,unit,status,notes FROM shopping_items WHERE household_id=$1 AND status IN ('to_buy','deferred') ORDER BY CASE status WHEN 'to_buy' THEN 0 ELSE 1 END,lower(item) LIMIT 150`,
      [householdId],
    ),
    poolOrThrow().query<PlanningContext["recipes"][number]>(
      `SELECT r.id,r.title,r.source_type AS "sourceType",r.source_url AS "sourceUrl",substring(r.description for 500) AS description,r.cuisine,r.meal_types AS "mealTypes",r.planned_yield AS "plannedYield",r.servings,r.prep_minutes AS "prepMinutes",r.cook_minutes AS "cookMinutes",COALESCE((SELECT jsonb_agg(jsonb_build_object('item',x.entry->>'item','quantity',x.entry->'quantity','unit',x.entry->>'unit','optional',COALESCE((x.entry->>'optional')::boolean,false)) ORDER BY x.ordinality) FROM (SELECT entry,ordinality FROM jsonb_array_elements(r.ingredients) WITH ORDINALITY AS ingredient(entry,ordinality) ORDER BY ordinality LIMIT 40) x),'[]'::jsonb) AS ingredients,r.tags[1:20] AS tags,substring(r.notes for 700) AS notes,r.favorite,r.recipe_status AS "recipeStatus",r.freezer_friendly AS "freezerFriendly",r.leftover_friendly AS "leftoverFriendly",r.packed_lunch_friendly AS "packedLunchFriendly",(SELECT count(*)::int FROM meal_feedback f WHERE f.recipe_id=r.id) AS "feedbackCount" FROM recipes r WHERE r.household_id=$1 AND r.archived_at IS NULL AND r.recipe_status<>'avoid' ORDER BY r.favorite DESC,CASE r.recipe_status WHEN 'proven' THEN 0 ELSE 1 END,(SELECT count(*) FROM meal_feedback f WHERE f.recipe_id=r.id) DESC,r.updated_at DESC LIMIT 60`,
      [householdId],
    ),
    poolOrThrow().query<SaleRow>(
      `SELECT s.id,f.store_name AS "storeName",f.store_location AS "storeLocation",f.valid_from::text AS "validFrom",f.valid_until::text AS "validUntil",s.item,s.brand,s.category,s.package_size AS "packageSize",s.price::text,s.regular_price::text AS "regularPrice",s.savings_amount::text AS "savingsAmount",s.discount_percent::text AS "discountPercent",s.pricing_unit AS "pricingUnit",s.multi_buy_quantity AS "multiBuyQuantity",s.member_only AS "memberOnly",s.limit_text AS "limitText",substring(s.notes for 500) AS notes,s.prioritized,s.deal_grade AS "dealGrade",s.normalized_unit_price::text AS "normalizedUnitPrice",s.normalized_unit_measure AS "normalizedUnitMeasure",s.estimated_regular_price::text AS "estimatedRegularPrice" FROM flyer_sale_items s JOIN flyer_sources f ON f.id=s.flyer_source_id WHERE s.household_id=$1 AND s.status='accepted' AND f.status='committed' AND f.archived_at IS NULL AND f.valid_until>=$2::date AND f.valid_from<=$3::date ORDER BY s.prioritized DESC,f.valid_until,lower(f.store_name),lower(s.item)`,
      [householdId, startDate, endDate],
    ),
  ]);
  if (!household.rows[0]) throw new Error("Household not found");
  const inventoryRows = [...inventory.rows];
  const inventoryIds = new Set(inventoryRows.map((item) => item.id));
  for (const item of flavorAssets.rows)
    if (!inventoryIds.has(item.id)) {
      inventoryRows.push(item);
      inventoryIds.add(item.id);
    }
  const planningInventory = inventoryRows.map((item) => ({
    ...item,
    directMealUse: inferDirectMealUse(item),
  }));
  const planningFlavorAssets = flavorAssets.rows.map((item) => ({
    id: item.id,
    ingredient: item.ingredient,
    brandVariety: item.brandVariety,
    category: item.category,
    quantity: item.quantity,
    unit: item.unit,
    locationName: item.locationName,
    notes: item.notes,
  }));
  const rankedSales = rankSaleOpportunities(activeSales.rows, {
    inventory: planningInventory,
    preferences: preferences.rows,
    recentMeals: recentMeals.rows,
    flavorAssets: planningFlavorAssets,
    startDate,
  }).slice(0, 150);
  return {
    today: household.rows[0].today,
    timeZone: household.rows[0].timeZone,
    users: users.rows,
    inventory: planningInventory,
    flavorAssets: planningFlavorAssets,
    preferences: preferences.rows,
    feedback: feedback.rows,
    recentMeals: recentMeals.rows,
    existingMeals: existingMeals.rows,
    unscheduled: unscheduled.rows,
    shopping: shopping.rows,
    recipes: recipes.rows,
    activeSales: rankedSales,
    saleOpportunitySummary: {
      eligibleCount: activeSales.rows.length,
      suppliedCount: rankedSales.length,
      priorityCount: activeSales.rows.filter((sale) => sale.prioritized).length,
    },
  };
}
