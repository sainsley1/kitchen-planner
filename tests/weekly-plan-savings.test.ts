import { describe, expect, it } from "vitest";
import type { WeeklyPlan } from "@/lib/ai/contracts";
import { computeWeeklyPlanSavings } from "@/lib/services/weekly-savings";

describe("Weekly Plan Savings & Badge Computations", () => {
  it("calculates estimated plan savings and generates per-meal badges", () => {
    const mockPlan: WeeklyPlan = {
      planFormatVersion: 2,
      title: "Value Meal Plan",
      summary: "Balanced weekly plan leveraging A+ sales",
      strategy: "Leverage salmon and pork tenderloin deals",
      warnings: [],
      reviewScorecard: {
        qualifiedSalesConsidered: 5,
        prioritySalesConsidered: 2,
        saleItemIdsUsed: ["11111111-1111-4111-8111-111111111111"],
        saleLinkedMealIds: ["meal-1"],
        useNowInventoryIdsUsed: [],
        useSoonInventoryIdsUsed: [],
        recentRepeats: [],
        familiarMealIds: ["meal-2"],
        discoveryMealIds: ["meal-1"],
        cuisines: ["American"],
        techniques: ["roasting"],
        primaryIngredients: ["salmon", "pork"],
      },
      meals: [
        {
          id: "meal-1",
          mealDate: "2026-08-03",
          mealType: "dinner",
          assignedUserId: null,
          dish: "Crispy Garlic Salmon with Roasted Asparagus",
          cuisine: "American",
          technique: "roasting",
          primaryIngredients: ["Atlantic Salmon", "Asparagus"],
          preparationBasis: "guided_method",
          preparationMethod: "Sear salmon skin-down and roast asparagus.",
          ingredientRequirements: [
            {
              item: "flavor_asset:garlic",
              category: "Produce",
              quantity: 2,
              unit: "cloves",
              optional: false,
              inventoryEntryId: null,
            },
            {
              item: "Atlantic Salmon",
              category: "Meat & Seafood",
              quantity: 1.5,
              unit: "lb",
              optional: false,
              inventoryEntryId: null,
            },
          ],
          saleItemIds: ["11111111-1111-4111-8111-111111111111"],
          discovery: true,
          recipeId: null,
          recipeTitle: null,
          recipeUrl: null,
          servings: 4,
          leftoverServings: 0,
          leftoverFromMealId: null,
          packedLunch: false,
          workplaceMeal: false,
          workplaceFriendly: true,
          intensity: "substantial",
          prepMinutes: 15,
          plannedYield: "4 servings",
          rationale: "Uses A+ Atlantic Salmon sale",
          notes: null,
          inventoryUses: [],
          unscheduledItemId: null,
        },
      ],
      coverageExceptions: [],
      prepTasks: [],
      shoppingDecisions: [],
      shopping: [
        {
          id: "shop-1",
          item: "Atlantic Salmon",
          category: "Meat & Seafood",
          quantity: 1.5,
          unit: "lb",
          reason: "Required for Crispy Garlic Salmon",
          mealIds: ["meal-1"],
          suggestedStore: "Safeway",
          saleItemId: "11111111-1111-4111-8111-111111111111",
          estimatedPrice: 7.49,
        },
      ],
    };

    const savings = computeWeeklyPlanSavings(mockPlan);

    expect(savings.totalSavingsUsd).toBeGreaterThan(5.0);
    expect(savings.stealsCount).toBe(1);
    expect(savings.flavorAssetsCount).toBe(1);
    expect(savings.mealBadges["meal-1"]).toHaveLength(2);
    expect(savings.mealBadges["meal-1"][0].label).toContain("A+ Sale Anchor");
    expect(savings.mealBadges["meal-1"][1].label).toContain("Flavor Asset: garlic");
  });
});
