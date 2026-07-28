import { describe, expect, it } from "vitest";
import { inferDirectMealUse } from "../lib/ai/inventory-meal-capability";

describe("direct meal use inventory classification", () => {
  it.each([
    ["Frozen pizza", "complete_meal"],
    ["Chicken pot pie", "complete_meal"],
    ["2 breakfast burritos", "complete_meal"],
    ["Leftover sausage pasta", "complete_meal"],
    ["20 clam fritters", "main_component"],
    ["Breaded oysters for frying", "main_component"],
    ["Pork souvlaki kebabs", "main_component"],
  ] as const)("allows %s to anchor a meal without a recipe", (ingredient, role) => {
    expect(inferDirectMealUse({ ingredient, locationName: "Top drawer of freezer" })).toMatchObject(
      { role, recipeRequired: false },
    );
  });

  it.each([
    ["31-40 peeled raw shrimp", "Seafood"],
    ["Salmon fillets", "Seafood"],
    ["Frozen green peas", "Vegetables"],
    ["Frozen mango", "Fruit"],
    ["Pizza sauce", "Condiments & Sauces"],
    ["Pizza dough", "Bread & Bakery"],
  ] as const)("keeps %s as an ordinary ingredient", (ingredient, category) => {
    expect(inferDirectMealUse({ ingredient, category, locationName: "Freezer" })).toBeNull();
  });

  it("does not classify an ambiguous pantry item without cold-storage or prepared-food evidence", () => {
    expect(
      inferDirectMealUse({
        ingredient: "Dumpling flour",
        category: "Pantry",
        locationName: "Bookshelf",
      }),
    ).toBeNull();
  });
});
