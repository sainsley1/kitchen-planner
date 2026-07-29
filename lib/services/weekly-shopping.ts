import "server-only";
import type { PlanningContext } from "@/lib/ai/context";
import type { WeeklyPlan } from "@/lib/ai/contracts";
import { boundWeeklyPlanWarnings } from "@/lib/services/weekly-warnings";

export const AUTO_SHORTFALL_PREFIX = "auto-shortfall-";
export const AUTO_REQUIREMENT_PREFIX = "auto-requirement-";
export const AUTO_INVENTORY_CONFIRMATION_PREFIX = "Confirm inventory quantity:";

export type ShoppingShortfallChange = {
  action: "added" | "increased";
  item: string;
  quantity: number | null;
  unit: string | null;
  mealIds: string[];
  source: "inventory_shortfall" | "ingredient_requirement";
};

type ShoppingLike = { item: string; quantity: number | string | null; unit: string | null };
type Shortfall = {
  ingredient: string;
  category: string;
  quantity: number;
  unit: string;
  unitKey: string;
  mealIds: Set<string>;
  inventoryIds: Set<string>;
  used: number;
  available: number;
};
type RequirementGroup = {
  item: string;
  category: string;
  quantity: number | null;
  unit: string | null;
  unitKey: string;
  mealIds: Set<string>;
  inventoryIds: Set<string>;
  saleItemIds: Set<string>;
  unknownQuantity: boolean;
};

const DISCRETE_UNITS = new Set([
  "bag",
  "bottle",
  "box",
  "bulb",
  "bunch",
  "can",
  "carton",
  "clove",
  "dozen",
  "each",
  "head",
  "jar",
  "loaf",
  "pack",
  "piece",
  "roll",
  "slice",
  "tray",
  "tub",
]);
const UNIT_ALIASES: Record<string, string> = {
  ea: "each",
  unit: "each",
  units: "each",
  bags: "bag",
  bottles: "bottle",
  boxes: "box",
  bulbs: "bulb",
  bunches: "bunch",
  cans: "can",
  cartons: "carton",
  cloves: "clove",
  dozens: "dozen",
  heads: "head",
  jars: "jar",
  loaves: "loaf",
  containers: "container",
  cups: "cup",
  package: "pack",
  packages: "pack",
  packs: "pack",
  pk: "pack",
  pkg: "pack",
  pc: "piece",
  pcs: "piece",
  pieces: "piece",
  rolls: "roll",
  slices: "slice",
  trays: "tray",
  tubs: "tub",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  gram: "g",
  grams: "g",
  kilogram: "kg",
  kilograms: "kg",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  pound: "lb",
  pounds: "lb",
  ounce: "oz",
  ounces: "oz",
};
const CONVERTIBLE_UNITS: Record<
  string,
  { family: "mass" | "volume" | "count"; baseFactor: number }
> = {
  g: { family: "mass", baseFactor: 1 },
  kg: { family: "mass", baseFactor: 1000 },
  oz: { family: "mass", baseFactor: 28.349523125 },
  lb: { family: "mass", baseFactor: 453.59237 },
  ml: { family: "volume", baseFactor: 1 },
  l: { family: "volume", baseFactor: 1000 },
  each: { family: "count", baseFactor: 1 },
  dozen: { family: "count", baseFactor: 12 },
};

function singularizedLastWord(value: string) {
  const words = value.split(" ");
  const last = words.at(-1);
  if (!last) return value;
  if (last.endsWith("ies") && last.length > 3) words[words.length - 1] = `${last.slice(0, -3)}y`;
  else if (last.endsWith("oes") && last.length > 3) words[words.length - 1] = last.slice(0, -2);
  else if (/(?:ches|shes|sses|xes|zes)$/.test(last)) words[words.length - 1] = last.slice(0, -2);
  else if (last.endsWith("s") && !/(?:ss|us|is)$/.test(last))
    words[words.length - 1] = last.slice(0, -1);
  return words.join(" ");
}
function normalizedName(value: string) {
  return singularizedLastWord(
    value
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, " ")
      .trim(),
  );
}
export function normalizedShoppingUnit(value: string | null | undefined) {
  const raw = (value ?? "").toLocaleLowerCase().trim().replace(/\.$/, "");
  return UNIT_ALIASES[raw] ?? raw;
}
export function shoppingRequirementKey(item: string, unit: string | null | undefined) {
  return `${normalizedName(item)}|${normalizedShoppingUnit(unit) || "unknown"}`;
}
export function ingredientNamesMatch(left: string, right: string) {
  const a = normalizedName(left);
  const b = normalizedName(right);
  return Boolean(a && b && (a === b || ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `)));
}
export function convertIngredientQuantity(
  quantity: number,
  fromUnit: string | null | undefined,
  toUnit: string | null | undefined,
) {
  const from = normalizedShoppingUnit(fromUnit);
  const to = normalizedShoppingUnit(toUnit);
  if (!from || !to) return null;
  if (from === to) return quantity;
  const source = CONVERTIBLE_UNITS[from];
  const target = CONVERTIBLE_UNITS[to];
  if (!source || !target || source.family !== target.family) return null;
  return (quantity * source.baseFactor) / target.baseFactor;
}
export function ingredientUnitsComparable(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  return convertIngredientQuantity(1, left, right) != null;
}
const namesMatch = ingredientNamesMatch;
function roundedShortfall(value: number, unitKey: string) {
  const precise = Number(value.toFixed(3));
  return DISCRETE_UNITS.has(unitKey) ? Math.ceil(precise) : precise;
}

export function normalizeWeeklyPlanMealLinkedRecords(plan: WeeklyPlan): WeeklyPlan {
  const prepTasks: WeeklyPlan["prepTasks"] = [];
  const usedPrepIds = new Set<string>();
  for (const task of plan.prepTasks) {
    if (!usedPrepIds.has(task.id)) {
      prepTasks.push({ ...task, mealIds: [...new Set(task.mealIds)] });
      usedPrepIds.add(task.id);
      continue;
    }
    const identical = prepTasks.find(
      (entry) =>
        entry.id === task.id &&
        entry.task === task.task &&
        entry.mealDate === task.mealDate &&
        entry.minutes === task.minutes,
    );
    if (identical) {
      identical.mealIds = [...new Set([...identical.mealIds, ...task.mealIds])];
      continue;
    }
    let sequence = 2;
    let id = "";
    do {
      const suffix = `-${sequence++}`;
      id = `${task.id.slice(0, 100 - suffix.length)}${suffix}`;
    } while (usedPrepIds.has(id));
    prepTasks.push({ ...task, id, mealIds: [...new Set(task.mealIds)] });
    usedPrepIds.add(id);
  }
  const shoppingDecisions = new Map<string, WeeklyPlan["shoppingDecisions"][number]>();
  for (const decision of plan.shoppingDecisions)
    shoppingDecisions.set(decision.requirementKey, {
      ...decision,
      mealIds: [...new Set(decision.mealIds)],
      inventoryEntryId: decision.action === "inventory" ? decision.inventoryEntryId : null,
    });
  return {
    ...plan,
    meals: plan.meals.map((meal) =>
      meal.leftoverFromMealId ? { ...meal, preparationBasis: "leftover" } : meal,
    ),
    shoppingDecisions: [...shoppingDecisions.values()],
    prepTasks,
  };
}
function finiteQuantity(value: number | string | null | undefined) {
  const parsed = value == null ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function lineMatches(line: ShoppingLike, ingredient: string, unitKey: string) {
  if (!namesMatch(line.item, ingredient)) return false;
  const lineUnit = normalizedShoppingUnit(line.unit);
  return !lineUnit || !unitKey || ingredientUnitsComparable(lineUnit, unitKey);
}
function lineCovers(line: ShoppingLike, ingredient: string, unitKey: string, quantity: number) {
  if (!namesMatch(line.item, ingredient)) return false;
  const current = finiteQuantity(line.quantity);
  const lineUnit = normalizedShoppingUnit(line.unit);
  if (current == null || !lineUnit) return true;
  const converted = convertIngredientQuantity(current, lineUnit, unitKey);
  return converted != null && converted >= quantity;
}
function safeSlug(value: string) {
  return normalizedName(value).replace(/\s+/g, "-").slice(0, 50) || "ingredient";
}
function recordedAmount(item: PlanningContext["inventory"][number]) {
  const quantity = finiteQuantity(item.quantity);
  if (quantity == null || quantity <= 0) return null;
  return `${Number(quantity.toFixed(3))}${item.unit ? ` ${item.unit}` : " recorded unit(s)"}`;
}
function categoryFor(item: string, preferred: string, context: PlanningContext) {
  return (
    context.inventory.find((entry) => namesMatch(entry.ingredient, item))?.category ??
    context.shopping.find((entry) => namesMatch(entry.item, item))?.category ??
    preferred ??
    "Other"
  );
}
function matchingInventory(
  item: string,
  inventoryEntryId: string | null,
  context: PlanningContext,
) {
  const named = context.inventory.filter((entry) => namesMatch(entry.ingredient, item));
  if (!inventoryEntryId) return named;
  const exact = context.inventory.find((entry) => entry.id === inventoryEntryId);
  return exact ? [exact, ...named.filter((entry) => entry.id !== exact.id)] : named;
}
function preferredInventory(
  item: string,
  unit: string | null,
  inventoryEntryId: string | null,
  context: PlanningContext,
) {
  const candidates = matchingInventory(item, inventoryEntryId, context);
  if (!unit) return candidates[0];
  return (
    candidates.find((entry) => ingredientUnitsComparable(entry.unit, unit)) ??
    candidates.find((entry) => recordedAmount(entry) != null) ??
    candidates[0]
  );
}
function enrichMealRequirements(plan: WeeklyPlan, context: PlanningContext): WeeklyPlan {
  return {
    ...plan,
    meals: plan.meals.map((meal) => {
      const recipe = meal.recipeId
        ? context.recipes.find((entry) => entry.id === meal.recipeId)
        : null;
      let ingredientRequirements = meal.ingredientRequirements;
      let preparationBasis = meal.leftoverFromMealId ? "leftover" : meal.preparationBasis;
      let primaryIngredients = meal.primaryIngredients;
      if (recipe?.ingredients.length) {
        const neededServings = meal.servings + meal.leftoverServings;
        const multiplier = recipe.servings ? Math.max(1, neededServings / recipe.servings) : 1;
        ingredientRequirements = recipe.ingredients.map((ingredient) => {
          const compatible = preferredInventory(ingredient.item, ingredient.unit, null, context);
          return {
            item: ingredient.item,
            category: categoryFor(ingredient.item, "Other", context),
            quantity:
              ingredient.quantity == null
                ? null
                : Number((ingredient.quantity * multiplier).toFixed(3)),
            unit: ingredient.unit,
            optional: Boolean(ingredient.optional),
            inventoryEntryId: compatible?.id ?? null,
          };
        });
        preparationBasis = meal.leftoverFromMealId ? "leftover" : "saved_recipe";
        if (!primaryIngredients.length)
          primaryIngredients = ingredientRequirements
            .filter((entry) => !entry.optional)
            .slice(0, 4)
            .map((entry) => entry.item);
      }
      ingredientRequirements = ingredientRequirements.map((requirement) => {
        if (requirement.inventoryEntryId) {
          const exact = context.inventory.find(
            (entry) => entry.id === requirement.inventoryEntryId,
          );
          if (exact && namesMatch(exact.ingredient, requirement.item)) return requirement;
        }
        const compatible = preferredInventory(requirement.item, requirement.unit, null, context);
        return { ...requirement, inventoryEntryId: compatible?.id ?? null };
      });
      const inventoryUses = meal.inventoryUses.map((entry) => ({ ...entry }));
      for (const requirement of ingredientRequirements) {
        if (requirement.optional) continue;
        const candidates = matchingInventory(
          requirement.item,
          requirement.inventoryEntryId,
          context,
        );
        if (!candidates.length) continue;
        if (
          inventoryUses.some(
            (entry) =>
              candidates.some((candidate) => candidate.id === entry.inventoryEntryId) &&
              (entry.quantity == null || ingredientUnitsComparable(entry.unit, requirement.unit)),
          )
        )
          continue;
        if (requirement.quantity == null || !requirement.unit) {
          const candidate =
            preferredInventory(
              requirement.item,
              requirement.unit,
              requirement.inventoryEntryId,
              context,
            ) ?? candidates[0];
          inventoryUses.push({
            inventoryEntryId: candidate.id,
            ingredient: requirement.item,
            quantity: null,
            unit: candidate.unit ?? requirement.unit,
          });
          continue;
        }
        let remaining = requirement.quantity;
        const comparable = candidates.filter((entry) =>
          ingredientUnitsComparable(entry.unit, requirement.unit),
        );
        for (const candidate of comparable) {
          const available = finiteQuantity(candidate.quantity);
          if (available == null || available <= 0) continue;
          const availableInRequirementUnit = convertIngredientQuantity(
            available,
            candidate.unit,
            requirement.unit,
          );
          if (availableInRequirementUnit == null || availableInRequirementUnit <= 0) continue;
          const amountInRequirementUnit = Math.min(availableInRequirementUnit, remaining);
          const amountInInventoryUnit = convertIngredientQuantity(
            amountInRequirementUnit,
            requirement.unit,
            candidate.unit,
          );
          if (amountInInventoryUnit == null || amountInInventoryUnit <= 0) continue;
          inventoryUses.push({
            inventoryEntryId: candidate.id,
            ingredient: requirement.item,
            quantity: Number(amountInInventoryUnit.toFixed(3)),
            unit: candidate.unit ?? requirement.unit,
          });
          remaining = Number((remaining - amountInRequirementUnit).toFixed(3));
          if (remaining <= 0) break;
        }
        const uncertain = candidates.find(
          (entry) =>
            recordedAmount(entry) != null &&
            !ingredientUnitsComparable(entry.unit, requirement.unit),
        );
        if (
          remaining > 0 &&
          uncertain &&
          !inventoryUses.some((entry) => entry.inventoryEntryId === uncertain.id)
        )
          inventoryUses.push({
            inventoryEntryId: uncertain.id,
            ingredient: requirement.item,
            quantity: null,
            unit: uncertain.unit,
          });
      }
      return {
        ...meal,
        preparationBasis,
        primaryIngredients,
        ingredientRequirements,
        inventoryUses,
      };
    }),
  };
}

/**
 * Add deterministic shopping coverage when a plan consumes more of an active
 * inventory record than is available and both sides use the same unit.
 * Re-running is idempotent: previously generated shortfall lines are rebuilt.
 */
function reconcileInventoryUseShortfalls(
  plan: WeeklyPlan,
  context: PlanningContext,
): { plan: WeeklyPlan; changes: ShoppingShortfallChange[] } {
  const inventory = new Map(context.inventory.map((item) => [item.id, item]));
  const decisions = new Set(plan.shoppingDecisions.map((decision) => decision.requirementKey));
  const useByEntry = new Map<
    string,
    { quantity: number; unit: string; unitKey: string; mealIds: Set<string>; ambiguous: boolean }
  >();
  for (const meal of plan.meals) {
    for (const use of meal.inventoryUses) {
      if (use.quantity == null || !use.unit) continue;
      const item = inventory.get(use.inventoryEntryId);
      if (!item?.unit) continue;
      const converted = convertIngredientQuantity(use.quantity, use.unit, item.unit);
      const unitKey = normalizedShoppingUnit(item.unit);
      if (!unitKey) continue;
      const next = useByEntry.get(use.inventoryEntryId) ?? {
        quantity: 0,
        unit: item.unit,
        unitKey,
        mealIds: new Set<string>(),
        ambiguous: false,
      };
      if (converted == null) {
        next.ambiguous = true;
        next.mealIds.add(meal.id);
        useByEntry.set(use.inventoryEntryId, next);
        continue;
      }
      next.quantity += converted;
      next.mealIds.add(meal.id);
      useByEntry.set(use.inventoryEntryId, next);
    }
  }

  const grouped = new Map<string, Shortfall>();
  for (const [inventoryId, use] of useByEntry) {
    const item = inventory.get(inventoryId);
    const available = finiteQuantity(item?.quantity);
    if (
      !item ||
      available == null ||
      use.ambiguous ||
      normalizedShoppingUnit(item.unit) !== use.unitKey ||
      use.quantity <= available
    )
      continue;
    const key = shoppingRequirementKey(item.ingredient, use.unitKey);
    const shortage = roundedShortfall(use.quantity - available, use.unitKey);
    if (shortage <= 0) continue;
    const current = grouped.get(key);
    if (current) {
      current.quantity = roundedShortfall(current.quantity + shortage, use.unitKey);
      current.used += use.quantity;
      current.available += available;
      for (const id of use.mealIds) current.mealIds.add(id);
      current.inventoryIds.add(inventoryId);
    } else
      grouped.set(key, {
        ingredient: item.ingredient,
        category: item.category,
        quantity: shortage,
        unit: item.unit ?? use.unit,
        unitKey: use.unitKey,
        mealIds: new Set(use.mealIds),
        inventoryIds: new Set([inventoryId]),
        used: use.quantity,
        available,
      });
  }

  const shopping = plan.shopping
    .filter((line) => !line.id.startsWith(AUTO_SHORTFALL_PREFIX))
    .map((line) => ({ ...line, mealIds: [...line.mealIds] }));
  const changes: ShoppingShortfallChange[] = [];
  for (const shortage of grouped.values()) {
    if (decisions.has(shoppingRequirementKey(shortage.ingredient, shortage.unitKey))) continue;
    if (
      context.shopping.some((line) =>
        lineCovers(line, shortage.ingredient, shortage.unitKey, shortage.quantity),
      )
    )
      continue;
    const existing = shopping.find((line) =>
      lineMatches(line, shortage.ingredient, shortage.unitKey),
    );
    const mealIds = [...shortage.mealIds];
    if (existing) {
      const current = finiteQuantity(existing.quantity);
      const currentInShortageUnit =
        current == null ? null : convertIngredientQuantity(current, existing.unit, shortage.unit);
      if (currentInShortageUnit != null && currentInShortageUnit < shortage.quantity) {
        const neededInExistingUnit =
          convertIngredientQuantity(shortage.quantity, shortage.unit, existing.unit) ??
          shortage.quantity;
        existing.quantity = roundedShortfall(
          neededInExistingUnit,
          normalizedShoppingUnit(existing.unit) || shortage.unitKey,
        );
        existing.unit = existing.unit ?? shortage.unit;
        existing.mealIds = [...new Set([...existing.mealIds, ...mealIds])];
        changes.push({
          action: "increased",
          item: existing.item,
          quantity: existing.quantity,
          unit: existing.unit,
          mealIds,
          source: "inventory_shortfall",
        });
      }
      continue;
    }
    const firstInventoryId = [...shortage.inventoryIds].sort()[0];
    const reason = `Automatically added: planned use is ${Number(shortage.used.toFixed(3))} ${shortage.unit}; recorded inventory provides ${Number(shortage.available.toFixed(3))} ${shortage.unit}. Buy at least ${shortage.quantity} ${shortage.unit}.`;
    shopping.push({
      id: `${AUTO_SHORTFALL_PREFIX}${firstInventoryId}`,
      item: shortage.ingredient,
      requirementKey: shoppingRequirementKey(shortage.ingredient, shortage.unitKey),
      category: shortage.category,
      quantity: shortage.quantity,
      unit: shortage.unit,
      reason,
      mealIds,
      suggestedStore: null,
      saleItemId: null,
      estimatedPrice: null,
    });
    changes.push({
      action: "added",
      item: shortage.ingredient,
      quantity: shortage.quantity,
      unit: shortage.unit,
      mealIds,
      source: "inventory_shortfall",
    });
  }
  return { plan: { ...plan, shopping }, changes };
}

function reconcileIngredientRequirements(
  plan: WeeklyPlan,
  context: PlanningContext,
): { plan: WeeklyPlan; changes: ShoppingShortfallChange[] } {
  const decisions = new Set(plan.shoppingDecisions.map((decision) => decision.requirementKey));
  const grouped = new Map<string, RequirementGroup>();
  for (const meal of plan.meals) {
    if (meal.preparationBasis === "leftover") continue;
    for (const requirement of meal.ingredientRequirements) {
      if (requirement.optional) continue;
      const unitKey = normalizedShoppingUnit(requirement.unit);
      const key = shoppingRequirementKey(requirement.item, unitKey);
      const current = grouped.get(key) ?? {
        item: requirement.item,
        category: requirement.category,
        quantity: 0,
        unit: requirement.unit,
        unitKey,
        mealIds: new Set<string>(),
        inventoryIds: new Set<string>(),
        saleItemIds: new Set<string>(),
        unknownQuantity: false,
      };
      current.mealIds.add(meal.id);
      if (requirement.inventoryEntryId) current.inventoryIds.add(requirement.inventoryEntryId);
      for (const saleItemId of meal.saleItemIds) current.saleItemIds.add(saleItemId);
      if (requirement.quantity == null || !unitKey) {
        current.unknownQuantity = true;
        current.quantity = null;
      } else if (!current.unknownQuantity)
        current.quantity = Number(((current.quantity ?? 0) + requirement.quantity).toFixed(3));
      grouped.set(key, current);
    }
  }

  const shopping = plan.shopping
    .filter((line) => !line.id.startsWith(AUTO_REQUIREMENT_PREFIX))
    .map((line) => ({ ...line, mealIds: [...line.mealIds] }));
  const existingWarnings = plan.warnings.filter(
    (warning) => !warning.startsWith(AUTO_INVENTORY_CONFIRMATION_PREFIX),
  );
  const confirmationWarnings: string[] = [];
  const changes: ShoppingShortfallChange[] = [];
  for (const requirement of grouped.values()) {
    if (decisions.has(shoppingRequirementKey(requirement.item, requirement.unitKey))) continue;
    const sale =
      [...requirement.saleItemIds]
        .map((id) => context.activeSales.find((entry) => entry.id === id))
        .find((entry) => entry && namesMatch(entry.item, requirement.item)) ?? null;
    const saleFields = sale
      ? { suggestedStore: sale.storeName, saleItemId: sale.id, estimatedPrice: Number(sale.price) }
      : { suggestedStore: null, saleItemId: null, estimatedPrice: null };
    const inventory = matchingInventory(
      requirement.item,
      [...requirement.inventoryIds][0] ?? null,
      context,
    );
    const namedPlanLines = shopping.filter((line) => namesMatch(line.item, requirement.item));
    const namedActiveLines = context.shopping.filter((line) =>
      namesMatch(line.item, requirement.item),
    );
    const planLines = namedPlanLines.filter((line) =>
      lineMatches(line, requirement.item, requirement.unitKey),
    );
    const activeLines = namedActiveLines.filter((line) =>
      lineMatches(line, requirement.item, requirement.unitKey),
    );
    if (requirement.unknownQuantity || requirement.quantity == null || !requirement.unitKey) {
      if (inventory.length || namedPlanLines.length || namedActiveLines.length) continue;
      const mealIds = [...requirement.mealIds];
      shopping.push({
        id: `${AUTO_REQUIREMENT_PREFIX}${safeSlug(requirement.item)}-${shopping.length + 1}`.slice(
          0,
          100,
        ),
        item: requirement.item,
        requirementKey: shoppingRequirementKey(requirement.item, requirement.unitKey),
        category: requirement.category,
        quantity: null,
        unit: requirement.unit,
        reason:
          "Automatically added: this preparation requires the ingredient, but no matching inventory or active shopping entry is recorded. Confirm the package quantity while shopping.",
        mealIds,
        ...saleFields,
      });
      changes.push({
        action: "added",
        item: requirement.item,
        quantity: null,
        unit: requirement.unit,
        mealIds,
        source: "ingredient_requirement",
      });
      continue;
    }
    if (
      [...namedPlanLines, ...namedActiveLines].some(
        (line) => finiteQuantity(line.quantity) == null || !normalizedShoppingUnit(line.unit),
      )
    )
      continue;
    if (
      [...namedPlanLines, ...namedActiveLines].some(
        (line) => !ingredientUnitsComparable(line.unit, requirement.unitKey),
      )
    )
      continue;
    const inventoryAvailable = inventory.reduce((total, entry) => {
      const quantity = finiteQuantity(entry.quantity);
      if (quantity == null) return total;
      return total + (convertIngredientQuantity(quantity, entry.unit, requirement.unitKey) ?? 0);
    }, 0);
    const shoppingAvailable = [...planLines, ...activeLines].reduce((total, line) => {
      const quantity = finiteQuantity(line.quantity);
      if (quantity == null) return total;
      return total + (convertIngredientQuantity(quantity, line.unit, requirement.unitKey) ?? 0);
    }, 0);
    const shortfall = roundedShortfall(
      requirement.quantity - inventoryAvailable - shoppingAvailable,
      requirement.unitKey,
    );
    if (shortfall <= 0) continue;
    const uncertainInventory = inventory.filter(
      (entry) =>
        recordedAmount(entry) != null &&
        !ingredientUnitsComparable(entry.unit, requirement.unitKey),
    );
    if (uncertainInventory.length) {
      const recorded = uncertainInventory
        .map((entry) => recordedAmount(entry))
        .filter((value): value is string => Boolean(value))
        .join(" + ");
      confirmationWarnings.push(
        `${AUTO_INVENTORY_CONFIRMATION_PREFIX} ${requirement.item} is recorded as ${recorded}, but the plan needs ${Number(shortfall.toFixed(3))} ${requirement.unit}; confirm the recorded container has enough. It was not added automatically.`,
      );
      continue;
    }
    const mealIds = [...requirement.mealIds];
    const existing = shopping.find((line) =>
      lineMatches(line, requirement.item, requirement.unitKey),
    );
    if (existing) {
      const current = finiteQuantity(existing.quantity);
      const currentInRequirementUnit =
        current == null
          ? 0
          : (convertIngredientQuantity(current, existing.unit, requirement.unitKey) ?? 0);
      const nextInRequirementUnit = currentInRequirementUnit + shortfall;
      const nextInExistingUnit = existing.unit
        ? convertIngredientQuantity(nextInRequirementUnit, requirement.unitKey, existing.unit)
        : nextInRequirementUnit;
      const next = roundedShortfall(
        nextInExistingUnit ?? nextInRequirementUnit,
        normalizedShoppingUnit(existing.unit) || requirement.unitKey,
      );
      existing.quantity = next;
      existing.unit = existing.unit ?? requirement.unit;
      existing.mealIds = [...new Set([...existing.mealIds, ...mealIds])];
      if (sale && !existing.saleItemId) {
        existing.saleItemId = sale.id;
        existing.suggestedStore = sale.storeName;
        existing.estimatedPrice = Number(sale.price);
      }
      changes.push({
        action: "increased",
        item: existing.item,
        quantity: next,
        unit: existing.unit,
        mealIds,
        source: "ingredient_requirement",
      });
      continue;
    }
    shopping.push({
      id: `${AUTO_REQUIREMENT_PREFIX}${safeSlug(requirement.item)}-${shopping.length + 1}`.slice(
        0,
        100,
      ),
      item: requirement.item,
      requirementKey: shoppingRequirementKey(requirement.item, requirement.unitKey),
      category: requirement.category,
      quantity: shortfall,
      unit: requirement.unit,
      reason: `Automatically added from complete preparation requirements after accounting for ${Number(inventoryAvailable.toFixed(3))} ${requirement.unit} in inventory and ${Number(shoppingAvailable.toFixed(3))} ${requirement.unit} already on shopping lists.`,
      mealIds,
      ...saleFields,
    });
    changes.push({
      action: "added",
      item: requirement.item,
      quantity: shortfall,
      unit: requirement.unit,
      mealIds,
      source: "ingredient_requirement",
    });
  }
  return {
    plan: {
      ...plan,
      shopping,
      warnings: boundWeeklyPlanWarnings([...confirmationWarnings, ...existingWarnings]),
    },
    changes,
  };
}

function repeatMatch(left: string, right: string) {
  const a = normalizedName(left);
  const b = normalizedName(right);
  return Boolean(
    a && b && (a === b || (Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a)))),
  );
}

export function buildWeeklyPlanScorecard(
  plan: WeeklyPlan,
  context: PlanningContext,
): WeeklyPlan["reviewScorecard"] {
  const saleItemIdsUsed = [
    ...new Set([
      ...plan.meals.flatMap((meal) => meal.saleItemIds),
      ...plan.shopping.map((line) => line.saleItemId).filter((id): id is string => Boolean(id)),
    ]),
  ];
  const saleLinkedMealIds = [
    ...new Set([
      ...plan.meals.filter((meal) => meal.saleItemIds.length).map((meal) => meal.id),
      ...plan.shopping.filter((line) => Boolean(line.saleItemId)).flatMap((line) => line.mealIds),
    ]),
  ];
  const usedInventoryIds = new Set(
    plan.meals.flatMap((meal) => meal.inventoryUses.map((use) => use.inventoryEntryId)),
  );
  const recentRepeats = plan.meals
    .filter((meal) => ["breakfast", "lunch", "dinner"].includes(meal.mealType))
    .flatMap((meal) => {
      const recent = context.recentMeals.find((entry) => repeatMatch(entry.dish, meal.dish));
      return recent
        ? [
            {
              mealId: meal.id,
              dish: meal.dish,
              recentDish: recent.dish,
              recentDate: recent.mealDate,
            },
          ]
        : [];
    });
  const distinct = (values: string[]) =>
    [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
  return {
    qualifiedSalesConsidered: context.saleOpportunitySummary.eligibleCount,
    prioritySalesConsidered: context.saleOpportunitySummary.priorityCount,
    saleItemIdsUsed,
    saleLinkedMealIds,
    useNowInventoryIdsUsed: context.inventory
      .filter((item) => item.priority === "use_now" && usedInventoryIds.has(item.id))
      .map((item) => item.id),
    useSoonInventoryIdsUsed: context.inventory
      .filter((item) => item.priority === "use_soon" && usedInventoryIds.has(item.id))
      .map((item) => item.id),
    recentRepeats,
    cuisines: distinct(plan.meals.map((meal) => meal.cuisine)),
    techniques: distinct(
      plan.meals.map((meal) => meal.technique).filter((value) => value !== "unspecified"),
    ),
    primaryIngredients: distinct(plan.meals.flatMap((meal) => meal.primaryIngredients)),
    discoveryMealIds: plan.meals.filter((meal) => meal.discovery).map((meal) => meal.id),
    familiarMealIds: plan.meals.filter((meal) => !meal.discovery).map((meal) => meal.id),
  };
}

/**
 * Expand saved recipes into complete meal requirements, reconcile both
 * ingredient requirements and explicit inventory use, then calculate the
 * deterministic plan-review scorecard. Re-running is idempotent.
 */
export function reconcileWeeklyPlanShopping(
  plan: WeeklyPlan,
  context: PlanningContext,
): { plan: WeeklyPlan; changes: ShoppingShortfallChange[] } {
  const normalized = normalizeWeeklyPlanMealLinkedRecords(plan);
  const enriched = enrichMealRequirements(normalized, context);
  const requirements = reconcileIngredientRequirements(enriched, context);
  const inventory = reconcileInventoryUseShortfalls(requirements.plan, context);
  const scored = {
    ...inventory.plan,
    reviewScorecard: buildWeeklyPlanScorecard(inventory.plan, context),
  };
  return { plan: scored, changes: [...requirements.changes, ...inventory.changes] };
}

/** @deprecated Use reconcileWeeklyPlanShopping. */
export function reconcileSameUnitShoppingShortfalls(plan: WeeklyPlan, context: PlanningContext) {
  return reconcileWeeklyPlanShopping(plan, context);
}

export function hasSameUnitShoppingCoverage(
  plan: WeeklyPlan,
  context: PlanningContext,
  ingredient: string,
  unit: string,
  quantity: number,
) {
  const unitKey = normalizedShoppingUnit(unit);
  return [...plan.shopping, ...context.shopping].some((line) =>
    lineCovers(line, ingredient, unitKey, quantity),
  );
}
