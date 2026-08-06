"use client";

import type { WeeklyPlan } from "@/lib/ai/contracts";
import type { HouseholdUserRecord, WeeklyPlanRecord } from "@/lib/db/queries";
import { formatDateKey } from "@/lib/datetime";
import { formatQuantity } from "@/lib/format";
import { optionLabel } from "@/lib/options";
import { computeWeeklyPlanSavings } from "@/lib/services/weekly-savings";

interface WeeklyPlanDayViewProps {
  plan: WeeklyPlanRecord;
  payload: WeeklyPlan;
  users: HouseholdUserRecord[];
}

export function WeeklyPlanDayView({ plan, payload, users }: WeeklyPlanDayViewProps) {
  const grouped = Map.groupBy(payload.meals, (meal) => meal.mealDate);
  const planDates = [
    ...new Set([
      ...payload.meals.map((meal) => meal.mealDate),
      ...payload.coverageExceptions.map((entry) => entry.mealDate),
    ]),
  ].sort();

  const savings = computeWeeklyPlanSavings(payload);

  return (
    <div className="plan-days">
      {planDates.map((date) => {
        const meals = grouped.get(date) ?? [];
        const exceptions = payload.coverageExceptions.filter(
          (entry) => entry.mealDate === date,
        );
        return (
          <section className="plan-day" key={date}>
            <h4>
              {formatDateKey(date, { weekday: "long", month: "short", day: "numeric" })}
            </h4>
            {meals.map((meal) => {
              const recipeSource = plan.recipeSources.find(
                (source) => source.url === meal.recipeUrl,
              );
              const badges = savings.mealBadges[meal.id] ?? [];
              return (
                <div className="plan-meal" key={meal.id}>
                  <span>
                    {optionLabel(meal.mealType)}
                    {meal.assignedUserId
                      ? ` · ${users.find((user) => user.id === meal.assignedUserId)?.displayName ?? "Person"}`
                      : ""}
                  </span>
                  <div>
                    <strong>{meal.dish}</strong>
                    <small>
                      {meal.cuisine} · {meal.technique} · {meal.servings} serving
                      {meal.servings === 1 ? "" : "s"} · {meal.prepMinutes} min ·{" "}
                      {meal.intensity}
                    </small>
                    <p>{meal.rationale}</p>
                    {badges.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "6px",
                          margin: "4px 0 8px 0",
                        }}
                      >
                        {badges.map((badge, idx) => (
                          <span
                            key={`${meal.id}-badge-${idx}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "11px",
                              fontWeight: 700,
                              padding: "2px 7px",
                              borderRadius: "4px",
                              background:
                                badge.type === "sale_anchor" ? "#fef7e0" : "#e6f4ea",
                              color:
                                badge.type === "sale_anchor" ? "#b06000" : "#137333",
                              border: `1px solid ${badge.type === "sale_anchor" ? "#feefc3" : "#ceead6"}`,
                            }}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    )}
                    {meal.preparationMethod && (
                      <details className="meal-preparation">
                        <summary>
                          {optionLabel(meal.preparationBasis)} ·{" "}
                          {meal.ingredientRequirements.length} required ingredient
                          {meal.ingredientRequirements.length === 1 ? "" : "s"}
                        </summary>
                        <p>{meal.preparationMethod}</p>
                        <small>
                          {meal.ingredientRequirements
                            .map(
                              (requirement) =>
                                `${requirement.item}${requirement.quantity != null ? ` ${formatQuantity(requirement.quantity)}${requirement.unit ? ` ${requirement.unit}` : ""}` : ""}${requirement.optional ? " (optional)" : ""}`,
                            )
                            .join(", ")}
                        </small>
                      </details>
                    )}
                    {meal.inventoryUses.length > 0 && (
                      <small>
                        Inventory:{" "}
                        {meal.inventoryUses
                          .map(
                            (use) =>
                              `${use.ingredient}${use.quantity != null ? ` ${formatQuantity(use.quantity)}${use.unit ? ` ${use.unit}` : ""}` : ""}`,
                          )
                          .join(", ")}
                      </small>
                    )}
                    {meal.unscheduledItemId && <em>Schedules an Unscheduled item</em>}
                    {meal.notes && <em>{meal.notes}</em>}
                    {meal.recipeUrl && (
                      <a href={meal.recipeUrl} target="_blank" rel="noreferrer">
                        {meal.recipeTitle ?? "Recipe source"} ↗
                      </a>
                    )}
                    {recipeSource && (
                      <small className="verified-recipe-source">
                        Verified live source · {recipeSource.domain}
                      </small>
                    )}
                    {meal.leftoverFromMealId && (
                      <em>
                        Uses leftovers from{" "}
                        {payload.meals.find(
                          (source) => source.id === meal.leftoverFromMealId,
                        )?.dish ?? "an earlier meal"}
                      </em>
                    )}
                  </div>
                  <div className="meal-flags">
                    {meal.recipeId && <span>Saved recipe</span>}
                    {recipeSource && <span>Source verified</span>}
                    {meal.discovery && <span>Discovery</span>}
                    {meal.saleItemIds.length > 0 && (
                      <span>
                        {meal.saleItemIds.length} sale anchor
                        {meal.saleItemIds.length === 1 ? "" : "s"}
                      </span>
                    )}
                    {meal.leftoverServings > 0 && (
                      <span>Reserve {meal.leftoverServings}</span>
                    )}
                    {meal.packedLunch && <span>Packed</span>}
                    {meal.workplaceMeal && (
                      <span>
                        {meal.workplaceFriendly ? "Work-friendly" : "Work warning"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {exceptions.map((entry) => (
              <div className="plan-meal plan-exception" key={entry.id}>
                <span>
                  {optionLabel(entry.mealType)} ·{" "}
                  {users.find((user) => user.id === entry.userId)?.displayName ??
                    "Person"}
                </span>
                <div>
                  <strong>No meal required</strong>
                  <p>{entry.reason}</p>
                </div>
                <div className="meal-flags">
                  <span>Exception</span>
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
