import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import {
  weeklyPlanMealSchema,
  weeklyPlanGenerationSchema,
  weeklyPlanRequestSchema,
  weeklyPlanRefinementSchema,
  weeklyPlanSchema,
  weeklyPlanSuggestionSchema,
  recipeSourceCheckSchema,
  recipeImportDraftSchema,
  flyerExtractionSchema,
  flyerSaleInputSchema,
  normalizeFlyerExtraction,
  validateFeedbackProposal,
  validateGroceryRecommendation,
  validateQuickProposal,
} from "../lib/ai/contracts";

const inventoryId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const shoppingId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";

describe("AI structured-output post-validation", () => {
  it("emits a Structured Outputs-compatible recipe URL schema", () => {
    for (const [schemaValue, name] of [
      [weeklyPlanGenerationSchema, "kitchen_weekly_plan"],
      [weeklyPlanSchema, "kitchen_weekly_plan_persisted"],
      [weeklyPlanRefinementSchema, "kitchen_weekly_refinement"],
      [weeklyPlanSuggestionSchema, "kitchen_weekly_suggestion"],
      [recipeSourceCheckSchema, "kitchen_recipe_source_check"],
      [recipeImportDraftSchema, "kitchen_recipe_import"],
      [flyerExtractionSchema, "kitchen_flyer_extraction"],
    ] as const) {
      const format = zodTextFormat(schemaValue, name);
      const schema = JSON.stringify(format.schema);
      expect(schema).not.toContain('"format":"uri"');
      if (
        schema.includes("sourceUrl") ||
        schema.includes("recipeUrl") ||
        schema.includes("requestedUrl")
      )
        expect(schema).toContain('"pattern":"^https?:\\\\/\\\\/\\\\S+$"');
    }
  });

  it("keeps deterministic weekly-plan fields out of the model response contract", () => {
    const schema = zodTextFormat(weeklyPlanGenerationSchema, "kitchen_weekly_plan").schema as {
      properties: Record<string, unknown>;
    };
    expect(schema.properties).not.toHaveProperty("shopping");
    expect(schema.properties).not.toHaveProperty("reviewScorecard");
    expect(schema.properties).not.toHaveProperty("planFormatVersion");
    expect(schema.properties.warnings).not.toHaveProperty("maxItems");
    const meals = schema.properties.meals as { items: { properties: Record<string, unknown> } };
    expect(meals.items.properties).not.toHaveProperty("inventoryUses");
    expect(meals.items.properties).toHaveProperty("ingredientRequirements");
  });

  it("keeps multi-buy regular prices comparable without rejecting the flyer", () => {
    const sale = {
      item: "Shanghai bok choy",
      brand: null,
      category: "Produce",
      packageSize: "1 lb",
      price: 6,
      regularPrice: 3.99,
      savingsAmount: null,
      discountPercent: null,
      pricingUnit: "2-pack total",
      multiBuyQuantity: 2,
      memberOnly: false,
      limitText: null,
      notes: null,
      confidence: 0.96,
      evidenceText: "2 for $6; regular $3.99 each",
      sourceReference: "Page 3",
      status: "proposed" as const,
      prioritized: false,
    };
    expect(() => flyerSaleInputSchema.parse(sale)).not.toThrow();
    const extraction = normalizeFlyerExtraction({ sales: [sale], warnings: [] });
    expect(extraction.sales[0]).toMatchObject({
      price: 6,
      regularPrice: 3.99,
      multiBuyQuantity: 2,
      confidence: 0.96,
    });
    expect(extraction.warnings).toEqual([]);
  });

  it("isolates a genuinely inconsistent extracted price instead of rejecting every sale", () => {
    const good = {
      item: "Napa cabbage",
      brand: null,
      category: "Produce",
      packageSize: "1 each",
      price: 2.99,
      regularPrice: 4.99,
      savingsAmount: 2,
      discountPercent: 40.08,
      pricingUnit: "each",
      multiBuyQuantity: null,
      memberOnly: false,
      limitText: null,
      notes: null,
      confidence: 0.97,
      evidenceText: "$2.99, regular $4.99",
      sourceReference: "Page 1",
      status: "proposed" as const,
      prioritized: false,
    };
    const suspect = {
      ...good,
      item: "Asian pears",
      price: 5.99,
      regularPrice: 3.99,
      savingsAmount: 2,
      discountPercent: 33.39,
      confidence: 0.98,
      evidenceText: "Price text is crowded",
      sourceReference: "Page 4",
    };
    expect(() =>
      flyerExtractionSchema.parse({ sales: [good, suspect], warnings: [] }),
    ).not.toThrow();
    expect(() => flyerSaleInputSchema.parse(suspect)).toThrow(/comparable per-unit sale price/i);
    const extraction = normalizeFlyerExtraction({
      sales: [good, suspect],
      warnings: ["Check the final page."],
    });
    expect(extraction.sales).toHaveLength(2);
    expect(extraction.sales[0]).toMatchObject({
      item: "Napa cabbage",
      regularPrice: 4.99,
      confidence: 0.97,
    });
    expect(extraction.sales[1]).toMatchObject({
      item: "Asian pears",
      regularPrice: null,
      savingsAmount: null,
      discountPercent: null,
      confidence: 0.74,
    });
    expect(extraction.warnings[0]).toMatch(/Asian pears.*cleared for manual review/i);
    expect(extraction.warnings[1]).toBe("Check the final page.");
  });

  it("accepts absolute HTTP(S) recipe links and rejects unsafe schemes", () => {
    const meal = {
      id: "meal-1",
      mealDate: "2026-07-18",
      mealType: "dinner" as const,
      assignedUserId: null,
      dish: "Test dish",
      cuisine: "Flexible",
      recipeTitle: "Test recipe",
      recipeUrl: "https://example.com/recipe",
      servings: 2,
      leftoverServings: 0,
      leftoverFromMealId: null,
      packedLunch: false,
      workplaceMeal: false,
      workplaceFriendly: true,
      intensity: "moderate" as const,
      prepMinutes: 30,
      plannedYield: "2 servings",
      rationale: "A practical dinner for both people.",
      notes: null,
      unscheduledItemId: null,
      inventoryUses: [],
    };
    expect(weeklyPlanMealSchema.parse(meal).recipeUrl).toBe("https://example.com/recipe");
    expect(() =>
      weeklyPlanMealSchema.parse({ ...meal, recipeUrl: "javascript:alert(1)" }),
    ).toThrow();
    expect(() => weeklyPlanMealSchema.parse({ ...meal, recipeUrl: "https://" })).toThrow();
  });

  it("defaults old weekly-plan requests to balanced mode and accepts an explicit deep plan", () => {
    const request = {
      startDate: "2026-07-18",
      endDate: "2026-07-24",
      startMeal: "lunch",
      endMeal: "breakfast",
      notes: "",
      includeSnacks: true,
      includeDesserts: true,
      discoverRecipes: true,
    };
    expect(weeklyPlanRequestSchema.parse(request).planningMode).toBe("balanced");
    expect(weeklyPlanRequestSchema.parse({ ...request, planningMode: "deep" }).planningMode).toBe(
      "deep",
    );
  });

  it("accepts scoped quick actions and rejects invented database IDs", () => {
    const payload = {
      title: "Orange soda update",
      summary: "Use one drink",
      warnings: [],
      actions: [
        {
          id: "drink-one",
          type: "inventory_quantity",
          label: "Use one orange soda",
          explanation: "Morgan drank one",
          inventoryEntryId: inventoryId,
          quantityMode: "subtract",
          quantity: 1,
          ingredient: null,
          brandVariety: null,
          category: null,
          unit: null,
          storageLocationId: null,
          storageDetail: null,
          packageState: null,
          priority: null,
          notes: null,
          addToShopping: false,
          shoppingItemId: null,
          shoppingStatus: null,
        },
      ],
    };
    expect(
      validateQuickProposal(payload, {
        inventoryIds: new Set([inventoryId]),
        locationIds: new Set([locationId]),
        shoppingIds: new Set([shoppingId]),
      }).actions,
    ).toHaveLength(1);
    expect(() =>
      validateQuickProposal(
        { ...payload, actions: [{ ...payload.actions[0], inventoryEntryId: shoppingId }] },
        {
          inventoryIds: new Set([inventoryId]),
          locationIds: new Set([locationId]),
          shoppingIds: new Set([shoppingId]),
        },
      ),
    ).toThrow(/inventory item/i);
  });

  it("keeps reusable preference learning separate from meal feedback", () => {
    const payload = {
      title: "Pancake feedback",
      summary: "Record feedback and a breakfast preference",
      warnings: [],
      actions: [
        {
          id: "feedback",
          type: "feedback_create",
          label: "Save Morgan's feedback",
          explanation: "Direct dish feedback",
          userId,
          feedbackDate: "2026-07-15",
          dish: "Pancakes",
          rating: "Like",
          feedback: "Morgan likes oatmeal for breakfast.",
          nextTimeChanges: null,
          repeatDecision: "Repeat",
          topic: null,
          classification: null,
          detail: null,
          context: null,
          preferenceStatus: null,
        },
        {
          id: "preference",
          type: "preference_create",
          label: "Remember pancakes",
          explanation: "Reusable breakfast preference",
          userId,
          feedbackDate: null,
          dish: null,
          rating: null,
          feedback: null,
          nextTimeChanges: null,
          repeatDecision: null,
          topic: "Breakfast",
          classification: "strong_preference",
          detail: "Morgan likes oatmeal for breakfast.",
          context: "Breakfast",
          preferenceStatus: "active",
        },
      ],
    };
    expect(validateFeedbackProposal(payload, new Set([userId])).actions).toHaveLength(2);
    expect(() =>
      validateFeedbackProposal(
        { ...payload, actions: [{ ...payload.actions[0], userId: inventoryId }] },
        new Set([userId]),
      ),
    ).toThrow(/household member/i);
  });

  it("requires grocery recommendations to reference the selected shop", () => {
    const payload = {
      warnings: [],
      suggestions: [
        {
          shoppingItemId: shoppingId,
          category: "Produce",
          quantity: 1,
          unit: "each",
          storageLocationId: locationId,
          storageDetail: "Drawer",
          packageState: "full",
          priority: "normal",
          inventoryEntryId: null,
          notes: null,
          explanation: "Fresh produce belongs in the fridge drawer.",
        },
      ],
    };
    expect(
      validateGroceryRecommendation(payload, {
        shoppingIds: new Set([shoppingId]),
        inventoryIds: new Set([inventoryId]),
        locationIds: new Set([locationId]),
      }).suggestions,
    ).toHaveLength(1);
    expect(() =>
      validateGroceryRecommendation(
        { ...payload, suggestions: [{ ...payload.suggestions[0], shoppingItemId: inventoryId }] },
        {
          shoppingIds: new Set([shoppingId]),
          inventoryIds: new Set([inventoryId]),
          locationIds: new Set([locationId]),
        },
      ),
    ).toThrow(/unknown shopping/i);
  });

  it("clears invented optional grocery references without rejecting the useful recommendation", () => {
    const payload = {
      warnings: [],
      suggestions: [
        {
          shoppingItemId: shoppingId,
          category: "Produce",
          quantity: 1,
          unit: "each",
          storageLocationId: "77777777-7777-4777-8777-777777777777",
          storageDetail: "Drawer",
          packageState: "full",
          priority: "normal",
          inventoryEntryId: "88888888-8888-4888-8888-888888888888",
          notes: null,
          explanation: "Store this with similar produce.",
        },
      ],
    };
    const result = validateGroceryRecommendation(payload, {
      shoppingIds: new Set([shoppingId]),
      inventoryIds: new Set([inventoryId]),
      locationIds: new Set([locationId]),
    });
    expect(result.suggestions[0]).toMatchObject({
      shoppingItemId: shoppingId,
      inventoryEntryId: null,
      storageLocationId: null,
    });
    expect(result.warnings.join(" ")).toMatch(/unrecognized inventory match/i);
    expect(result.warnings.join(" ")).toMatch(/unrecognized storage location/i);
  });
});
