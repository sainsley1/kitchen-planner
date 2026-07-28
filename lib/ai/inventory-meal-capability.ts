export type DirectMealUse = {
  role: "complete_meal" | "main_component";
  recipeRequired: false;
  preparation: string;
  pairing: string;
};

export type InventoryMealCandidate = {
  ingredient: string;
  brandVariety?: string | null;
  category?: string | null;
  locationName?: string | null;
  storageDetail?: string | null;
  notes?: string | null;
};

function searchable(item: InventoryMealCandidate) {
  return [
    item.ingredient,
    item.brandVariety,
    item.category,
    item.locationName,
    item.storageDetail,
    item.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const COLD_STORAGE = /\b(freezer|frozen|fridge|refrigerat(?:ed|or|ion)?|chilled)\b/;
const EXPLICIT_PREPARED =
  /\b(frozen|leftover|prepared|pre cooked|precooked|ready to cook|ready to eat|heat and eat|reheat)\b/;
const NON_MEAL_PIZZA = /\bpizza (sauce|dough|crust|cheese|topping|seasoning)\b/;
const COMPLETE_MEAL =
  /\b(pizzas?|pot pies?|shepherds pies?|cottage pies?|lasagnas?|casseroles?|frozen dinners?|tv dinners?|burritos?|enchiladas?|stuffed shells|meal bowls?|mac(?:aroni)? and cheese)\b/;
const MAIN_COMPONENT =
  /\b(fritters?|breaded|battered|fish sticks?|fish fingers?|nuggets?|tenders?|croquettes?|cutlets?|dumplings?|gyoza|pierogi(?:es)?|samosas?|pakoras?|spring rolls?|egg rolls?|fries|onion rings?|falafel|meatballs?|sausage rolls?|hash browns?|patt(?:y|ies)|burger patt(?:y|ies)|kebabs?|souvlaki|empanadas?|arancini|mozzarella sticks?|taquitos?)\b/;

/**
 * Give the planner a compact, deterministic hint when a cold-stored item can
 * sensibly anchor a meal without inventing a recipe. This is deliberately
 * conservative: raw proteins, produce, sauces and other normal ingredients
 * remain unclassified even when they happen to be frozen.
 */
export function inferDirectMealUse(item: InventoryMealCandidate): DirectMealUse | null {
  const text = searchable(item);
  const storedCold = COLD_STORAGE.test(text) || EXPLICIT_PREPARED.test(text);
  if (!storedCold) return null;

  if (/\bleftover\b/.test(text))
    return {
      role: "complete_meal",
      recipeRequired: false,
      preparation: "Reheat safely using the recorded or original preparation method.",
      pairing:
        "Use as the meal itself; add only a simple vegetable, salad, bread, or condiment if it makes the meal more complete.",
    };

  if (!NON_MEAL_PIZZA.test(text) && COMPLETE_MEAL.test(text))
    return {
      role: "complete_meal",
      recipeRequired: false,
      preparation:
        "Heat, bake, or reheat according to the package or recorded household instructions.",
      pairing:
        "Use as the meal anchor; add at most one simple side when useful, and do not turn it into an elaborate cooking project.",
    };

  if (MAIN_COMPONENT.test(text))
    return {
      role: "main_component",
      recipeRequired: false,
      preparation:
        "Cook from its stored state using the package, label, or recorded household instructions and safe doneness guidance.",
      pairing:
        "Build a practical meal with an appropriate simple side and, when helpful, a complementary sauce or dip.",
    };

  return null;
}
