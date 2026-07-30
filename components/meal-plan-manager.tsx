"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { HouseholdUserRecord, MealInventoryReviewRecord, MealRecord } from "@/lib/db/queries";
import { formatDateKey, householdDateKey } from "@/lib/datetime";
import { MEAL_STATUSES, MEAL_TYPES, optionLabel } from "@/lib/options";

type ReviewState = { selected: boolean; amount: string; addToShopping: boolean };

export function MealPlanManager({
  items,
  users,
  timeZone,
  inventoryReviews,
}: {
  items: MealRecord[];
  users: HouseholdUserRecord[];
  timeZone: string;
  inventoryReviews: MealInventoryReviewRecord[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [mealDate, setMealDate] = useState(householdDateKey(new Date(), timeZone));
  const [mealType, setMealType] = useState("dinner");
  const [dish, setDish] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [plannedYield, setPlannedYield] = useState("");
  const [packedLunch, setPackedLunch] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewState, setReviewState] = useState<Record<string, ReviewState>>({});
  const grouped = useMemo(() => Map.groupBy(items, (item) => item.mealDate), [items]);
  const activeReview = inventoryReviews[0] ?? null;

  useEffect(() => {
    if (!activeReview) {
      setReviewState({});
      return;
    }
    setReviewState(
      Object.fromEntries(
        activeReview.suggestions.map((suggestion) => [
          suggestion.inventoryEntryId,
          {
            selected: suggestion.selectedByDefault,
            amount: suggestion.suggestedQuantity?.toString() ?? "",
            addToShopping: false,
          },
        ]),
      ),
    );
  }, [activeReview?.id]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/v1/meals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mealDate,
        mealType,
        dish,
        assignedUserId,
        plannedYield,
        packedLunch,
        status: "planned",
        notes,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setError(body.error || "Could not add meal.");
    setDish("");
    setNotes("");
    setAdding(false);
    router.refresh();
  }

  async function patch(id: string, body: unknown) {
    setError("");
    const response = await fetch(`/api/v1/meals/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return setError((await response.json().catch(() => ({}))).error || "Update failed.");
    }
    router.refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this planned meal?")) return;
    await fetch(`/api/v1/meals/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function resolveReview(action: "apply" | "dismiss") {
    if (!activeReview) return;
    const selected = activeReview.suggestions.flatMap((suggestion) => {
      const state = reviewState[suggestion.inventoryEntryId];
      const amount = Number(state?.amount);
      return state?.selected && Number.isFinite(amount) && amount > 0
        ? [
            {
              inventoryEntryId: suggestion.inventoryEntryId,
              amount,
              unit: suggestion.unit,
              addToShopping: state.addToShopping,
            },
          ]
        : [];
    });
    if (action === "apply" && !selected.length) {
      setError("Select at least one inventory item and enter a quantity to subtract.");
      return;
    }
    setReviewBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/meal-inventory-reviews/${activeReview.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "dismiss" ? { action: "dismiss" } : { action: "apply", items: selected },
        ),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Inventory review could not be saved.");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Inventory review could not be saved.");
    } finally {
      setReviewBusy(false);
    }
  }

  return (
    <>
      {activeReview && (
        <div
          className="inventory-review-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inventory-review-title"
        >
          <section className="inventory-review-modal">
            <header>
              <div>
                <span className="eyebrow">Archived meal day</span>
                <h2 id="inventory-review-title">
                  Update inventory for{" "}
                  {formatDateKey(activeReview.mealDate, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </h2>
                <p>
                  The plan recorded these ingredients as used. Select only what was actually
                  consumed and edit each quantity before applying it.
                </p>
              </div>
              {inventoryReviews.length > 1 && (
                <span className="status-chip warning">{inventoryReviews.length} reviews</span>
              )}
            </header>
            <div className="inventory-review-lines">
              {activeReview.suggestions.map((suggestion) => {
                const state = reviewState[suggestion.inventoryEntryId] ?? {
                  selected: false,
                  amount: "",
                  addToShopping: false,
                };
                return (
                  <div
                    className={`inventory-review-line ${state.selected ? "selected" : ""}`}
                    key={suggestion.inventoryEntryId}
                  >
                    <label className="checkbox-label inventory-review-choice">
                      <input
                        type="checkbox"
                        checked={state.selected}
                        onChange={(event) =>
                          setReviewState((current) => ({
                            ...current,
                            [suggestion.inventoryEntryId]: {
                              ...state,
                              selected: event.target.checked,
                            },
                          }))
                        }
                      />
                      <span>
                        <strong>{suggestion.ingredient}</strong>
                        <small>Used for {suggestion.dishes.join(", ")}</small>
                      </span>
                    </label>
                    <label>
                      Subtract
                      <input
                        type="number"
                        min="0.001"
                        max={suggestion.availableQuantity}
                        step="0.001"
                        disabled={!state.selected}
                        value={state.amount}
                        onChange={(event) =>
                          setReviewState((current) => ({
                            ...current,
                            [suggestion.inventoryEntryId]: { ...state, amount: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <span className="review-unit">
                      {suggestion.unit ?? "units"}
                      <small>{suggestion.availableQuantity} recorded</small>
                    </span>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        disabled={!state.selected}
                        checked={state.addToShopping}
                        onChange={(event) =>
                          setReviewState((current) => ({
                            ...current,
                            [suggestion.inventoryEntryId]: {
                              ...state,
                              addToShopping: event.target.checked,
                            },
                          }))
                        }
                      />
                      Re-add if depleted
                    </label>
                    {suggestion.unitMismatch && (
                      <small className="form-error">
                        The planned and recorded units differ; enter the amount in{" "}
                        {suggestion.unit ?? "the inventory unit"}.
                      </small>
                    )}
                  </div>
                );
              })}
            </div>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={reviewBusy}
                onClick={() => resolveReview("dismiss")}
              >
                Skip inventory update
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={reviewBusy}
                onClick={() => resolveReview("apply")}
              >
                {reviewBusy ? "Updating…" : "Update selected inventory"}
              </button>
            </div>
          </section>
        </div>
      )}
      <p className="meal-archive-note">
        When every entry on a day is no longer <strong>Planned</strong>, that day is archived
        automatically. Deferred entries return to Unscheduled items.
      </p>
      {adding ? (
        <form className="entity-form" onSubmit={add}>
          <div className="form-grid">
            <label>
              Date
              <input
                type="date"
                required
                value={mealDate}
                onChange={(event) => setMealDate(event.target.value)}
              />
            </label>
            <label>
              Meal
              <select value={mealType} onChange={(event) => setMealType(event.target.value)}>
                {MEAL_TYPES.map((type) => (
                  <option value={type} key={type}>
                    {optionLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-two">
              Dish
              <input required value={dish} onChange={(event) => setDish(event.target.value)} />
            </label>
            <label>
              For
              <select
                value={assignedUserId}
                onChange={(event) => setAssignedUserId(event.target.value)}
              >
                <option value="">Household</option>
                {users.map((user) => (
                  <option value={user.id} key={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Planned yield
              <input
                value={plannedYield}
                onChange={(event) => setPlannedYield(event.target.value)}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={packedLunch}
                onChange={(event) => setPackedLunch(event.target.checked)}
              />
              Packed lunch
            </label>
            <label className="span-two">
              Notes
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="primary-button">Add meal</button>
          </div>
        </form>
      ) : (
        <button className="primary-button add-inline" onClick={() => setAdding(true)}>
          Add meal
        </button>
      )}

      <div className="week-grid persistent-week">
        {Array.from(grouped.entries()).map(([date, meals]) => (
          <article className="day-card" key={date}>
            <header>
              <h2>{formatDateKey(date, { weekday: "long", month: "short", day: "numeric" })}</h2>
              <span className="meal-status">{meals.length} entries</span>
            </header>
            <div className="meal-entry-list">
              {meals.map((meal) => (
                <div className="meal-entry" key={meal.id}>
                  <span>
                    {optionLabel(meal.mealType)}
                    {meal.assignedName ? ` · ${meal.assignedName}` : ""}
                  </span>
                  <strong>{meal.dish}</strong>
                  <small>
                    {meal.packedLunch ? "Packed lunch · " : ""}
                    {meal.plannedYield || optionLabel(meal.status)}
                  </small>
                  <div className="row-actions">
                    <select
                      aria-label="Meal status"
                      value={meal.status}
                      onChange={(event) => patch(meal.id, { status: event.target.value })}
                    >
                      {MEAL_STATUSES.map((status) => (
                        <option value={status} key={status}>
                          {optionLabel(status)}
                        </option>
                      ))}
                    </select>
                    <button className="danger-link" onClick={() => remove(meal.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
      {items.length === 0 && (
        <p className="empty-state">No active meals are recorded in this date window.</p>
      )}
    </>
  );
}
