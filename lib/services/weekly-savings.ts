import type { WeeklyPlan } from "@/lib/ai/contracts";

export type MealBadge = {
  type: "sale_anchor" | "flavor_asset";
  label: string;
  grade?: "A+" | "A" | "B" | "C" | "F";
};

export type PlanSavingsSummary = {
  totalSavingsUsd: number;
  stealsCount: number;
  gradeACount: number;
  flavorAssetsCount: number;
  mealBadges: Record<string, MealBadge[]>;
};

/**
 * Computes estimated plan savings and generates per-meal value badges for a weekly plan.
 */
export function computeWeeklyPlanSavings(plan: WeeklyPlan): PlanSavingsSummary {
  let totalSavingsUsd = 0;
  let stealsCount = 0;
  let gradeACount = 0;
  let flavorAssetsCount = 0;
  const mealBadges: Record<string, MealBadge[]> = {};

  // Check shopping items with saleItemId or estimated savings
  for (const line of plan.shopping) {
    if (line.saleItemId && line.estimatedPrice != null) {
      // Estimated savings of ~$3.50 per sale line baseline
      const lineSavings = Math.max(1.5, Number((line.estimatedPrice * 0.35).toFixed(2)));
      totalSavingsUsd += lineSavings;
    }
  }

  const flavorRegex =
    /garlic|ginger|soy|hoisin|miso|sesame|curry|chili|teriyaki|pesto|harissa|tahini|kimchi|balsamic/i;

  for (const meal of plan.meals) {
    const badges: MealBadge[] = [];

    // Check sale anchors
    if (meal.saleItemIds.length > 0) {
      stealsCount += 1;
      const primaryItem = meal.primaryIngredients[0] || meal.dish;
      badges.push({
        type: "sale_anchor",
        label: `🔥 A+ Sale Anchor: ${primaryItem}`,
        grade: "A+",
      });
      totalSavingsUsd += 4.5; // Average $4.50 savings per primary sale anchor
    } else if (meal.discovery) {
      gradeACount += 1;
      const primaryItem = meal.primaryIngredients[0] || meal.dish;
      badges.push({
        type: "sale_anchor",
        label: `✅ Grade A Deal: ${primaryItem}`,
        grade: "A",
      });
      totalSavingsUsd += 2.5;
    }

    // Check flavor assets
    const matchedFlavors = meal.ingredientRequirements.filter(
      (req) => flavorRegex.test(req.item) || req.item.startsWith("flavor_asset:"),
    );
    if (matchedFlavors.length > 0) {
      flavorAssetsCount += matchedFlavors.length;
      const flavorName = matchedFlavors[0].item.replace(/^flavor_asset:/, "");
      badges.push({
        type: "flavor_asset",
        label: `🌿 Flavor Asset: ${flavorName}`,
      });
    }

    if (badges.length > 0) {
      mealBadges[meal.id] = badges;
    }
  }

  return {
    totalSavingsUsd: Number(totalSavingsUsd.toFixed(2)),
    stealsCount,
    gradeACount,
    flavorAssetsCount,
    mealBadges,
  };
}
