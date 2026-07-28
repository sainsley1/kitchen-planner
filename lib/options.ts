export const INVENTORY_PRIORITIES = ["normal", "use_soon", "use_now", "reserved"] as const;
export const PACKAGE_STATES = [
  "unknown",
  "sealed",
  "opened",
  "full",
  "partial",
  "nearly_empty",
] as const;
export const SHOPPING_STATUSES = ["to_buy", "purchased", "deferred", "removed"] as const;
export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "dessert", "prep"] as const;
export const MEAL_STATUSES = [
  "planned",
  "completed",
  "changed",
  "deferred",
  "skipped",
  "open",
  "unconfirmed",
] as const;
export const FEEDBACK_RATINGS = ["Love", "Like", "Mixed", "Dislike"] as const;
export const PREFERENCE_STATUSES = ["active", "contextual", "superseded"] as const;
export const REPEAT_DECISIONS = [
  "Repeat",
  "Repeat with changes",
  "Occasional",
  "Do not repeat",
] as const;

export const COMMON_INVENTORY_CATEGORIES = [
  "Baking & Cooking",
  "Beverages",
  "Bread & Bakery",
  "Canned & Jarred",
  "Condiments & Sauces",
  "Dairy & Eggs",
  "Frozen",
  "Fruit",
  "Grains, Pasta & Rice",
  "Meat",
  "Pantry",
  "Produce",
  "Seafood",
  "Snacks & Sweets",
  "Spices & Seasonings",
  "Vegetables",
] as const;

export const COMMON_INVENTORY_UNITS = [
  "bag",
  "bottle",
  "box",
  "bunch",
  "can",
  "clove",
  "each",
  "g",
  "jar",
  "kg",
  "L",
  "lb",
  "mL",
  "oz",
  "package",
  "piece",
  "roll",
] as const;

export function optionLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
