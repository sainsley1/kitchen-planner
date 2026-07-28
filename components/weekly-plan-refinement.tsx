"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { WeeklyPlanSuggestion } from "@/lib/ai/contracts";
import type { RecipeRecord, WeeklyPlanRecord } from "@/lib/db/queries";

type SuggestionResult = {
  id: string;
  kind: "alternatives" | "recipe_link";
  targetMealId: string;
  payload: WeeklyPlanSuggestion;
  modelTier: string;
};
type CheckResult = {
  check: {
    pageTitle: string | null;
    isAccessible: boolean;
    matchStatus: string;
    prepMinutes: number | null;
    yieldText: string | null;
    evidenceSummary: string;
    warnings: string[];
  };
  verified: boolean;
};
async function call(path: string, method: string, body?: unknown) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "The planning action failed.");
  return value;
}

export function WeeklyPlanRefinement({
  plan,
  recipes,
  routineModel,
  fallbackModel,
}: {
  plan: WeeklyPlanRecord;
  recipes: RecipeRecord[];
  routineModel: string;
  fallbackModel: string;
}) {
  const router = useRouter();
  const meals = plan.payload.meals;
  const dates = useMemo(() => [...new Set(meals.map((meal) => meal.mealDate))].sort(), [meals]);
  const [mealId, setMealId] = useState(meals[0]?.id ?? "");
  const [mealDate, setMealDate] = useState(dates[0] ?? plan.startDate);
  const [instruction, setInstruction] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [savedRecipeId, setSavedRecipeId] = useState(recipes[0]?.id ?? "");
  const [suggestion, setSuggestion] = useState<SuggestionResult | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selected = meals.find((meal) => meal.id === mealId);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The planning action failed.");
    } finally {
      setBusy(false);
    }
  }
  async function refine(scope: "meal" | "day") {
    if (!instruction.trim()) return setError("Describe what should change first.");
    await act(async () => {
      const target =
        selected && scope === "meal"
          ? selected.assignedUserId
            ? {
                scope: "person_meal",
                mealId: null,
                mealDate: selected.mealDate,
                mealType: selected.mealType,
                userId: selected.assignedUserId,
              }
            : { scope: "meal", mealId: selected.id, mealDate: null, mealType: null, userId: null }
          : { scope: "day", mealId: null, mealDate, mealType: null, userId: null };
      const response = await call(`/api/v1/weekly-plans/${plan.id}/refine`, "POST", {
        ...target,
        instruction,
        advanced,
      });
      setMessage(`${response.result.summary} Saved as revision ${response.result.revisionNumber}.`);
      setInstruction("");
      router.refresh();
    });
  }
  async function suggest(kind: "alternatives" | "recipe_link") {
    if (!selected) return;
    await act(async () => {
      const response = await call(`/api/v1/weekly-plans/${plan.id}/suggestions`, "POST", {
        kind,
        mealId: selected.id,
        instruction,
        advanced,
      });
      setSuggestion(response.suggestion);
      setCheck(null);
      setMessage(
        kind === "alternatives"
          ? "Choose one alternative below."
          : "Choose a verified recipe link below.",
      );
    });
  }
  async function apply(optionId: string) {
    if (!suggestion) return;
    await act(async () => {
      const response = await call(
        `/api/v1/weekly-plans/${plan.id}/suggestions/${suggestion.id}/apply`,
        "POST",
        { optionId },
      );
      setMessage(`${response.result.summary} Saved as revision ${response.result.revisionNumber}.`);
      setSuggestion(null);
      router.refresh();
    });
  }
  async function checkSource() {
    if (!selected?.recipeUrl) return setError("The selected meal has no recipe link.");
    await act(async () => {
      const response = await call(`/api/v1/weekly-plans/${plan.id}/recipe-check`, "POST", {
        mealId: selected.id,
      });
      setCheck(response);
      setSuggestion(null);
      setMessage(
        response.verified
          ? "The recipe source is an exact, evidence-backed match."
          : "The source could not be verified as an exact match.",
      );
      router.refresh();
    });
  }
  async function link(action: "saved_recipe" | "remove" | "keep") {
    if (!selected) return;
    await act(async () => {
      const response = await call(`/api/v1/weekly-plans/${plan.id}/recipe-link`, "PATCH", {
        mealId: selected.id,
        action,
        recipeId: action === "saved_recipe" ? savedRecipeId : null,
      });
      setMessage(response.result.summary);
      router.refresh();
    });
  }
  if (plan.status !== "draft") return null;
  return (
    <section className="plan-refinement-tools">
      <header>
        <div>
          <h4>Refine this draft</h4>
          <p className="muted">
            Targeted work uses {advanced ? fallbackModel : routineModel}; the rest of the draft
            remains unchanged.
          </p>
        </div>
        <span className="status-chip">v{plan.revisionNumber}</span>
      </header>
      <div className="form-grid">
        <label className="span-two">
          Meal
          <select
            value={mealId}
            onChange={(event) => {
              setMealId(event.target.value);
              setSuggestion(null);
              setCheck(null);
            }}
          >
            {meals.map((meal) => (
              <option key={meal.id} value={meal.id}>
                {meal.mealDate} · {meal.mealType} · {meal.dish}
              </option>
            ))}
          </select>
        </label>
        <label>
          Day
          <select value={mealDate} onChange={(event) => setMealDate(event.target.value)}>
            {dates.map((date) => (
              <option key={date}>{date}</option>
            ))}
          </select>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={advanced}
            onChange={(event) => setAdvanced(event.target.checked)}
          />
          Use advanced Terra for this request
        </label>
        <label className="span-two">
          What should change?
          <textarea
            maxLength={2000}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Make it lighter, preserve the assigned person's work restrictions, and use a use-soon vegetable."
          />
        </label>
      </div>
      <div className="refinement-actions">
        <button
          className="secondary-button"
          disabled={busy || !selected}
          onClick={() => refine("meal")}
        >
          Refine selected meal
        </button>
        <button className="secondary-button" disabled={busy} onClick={() => refine("day")}>
          Refine selected day
        </button>
        <button
          className="secondary-button"
          disabled={busy || !selected}
          onClick={() => suggest("alternatives")}
        >
          Find 3 alternatives
        </button>
        <button
          className="secondary-button"
          disabled={busy || !selected}
          onClick={() => suggest("recipe_link")}
        >
          Find verified links
        </button>
        <button
          className="secondary-button"
          disabled={busy || !selected?.recipeUrl}
          onClick={checkSource}
        >
          Check current source
        </button>
      </div>
      <div className="saved-recipe-tools">
        <label>
          Saved household recipe
          <select value={savedRecipeId} onChange={(event) => setSavedRecipeId(event.target.value)}>
            <option value="">Choose recipe</option>
            {recipes.map((recipe) => (
              <option key={recipe.id} value={recipe.id}>
                {recipe.title}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          disabled={busy || !selected || !savedRecipeId}
          onClick={() => link("saved_recipe")}
        >
          Attach saved recipe
        </button>
        <button
          className="danger-link"
          disabled={busy || !selected?.recipeUrl}
          onClick={() => link("remove")}
        >
          Remove link
        </button>
        <button
          className="secondary-button"
          disabled={busy || !selected?.recipeUrl}
          onClick={() => link("keep")}
        >
          Keep with warning
        </button>
      </div>
      {busy && <p className="muted">Working on the selected part of the draft…</p>}
      {error && <p className="form-error">{error}</p>}
      {message && <p className="form-success">{message}</p>}
      {suggestion?.kind === "alternatives" && (
        <div className="plan-suggestion-list">
          {suggestion.payload.alternatives.map((option) => (
            <article key={option.id}>
              <h5>{option.meal.dish}</h5>
              <p>{option.meal.rationale}</p>
              <small>
                {option.meal.cuisine} · {option.meal.prepMinutes} min · {option.meal.intensity}
              </small>
              <em>Shopping: {option.shoppingImpact}</em>
              <em>Leftovers: {option.leftoverImpact}</em>
              {option.meal.recipeUrl && (
                <a href={option.meal.recipeUrl} target="_blank" rel="noreferrer">
                  {option.meal.recipeTitle ?? "Verified recipe"} ↗
                </a>
              )}
              <button className="primary-button" disabled={busy} onClick={() => apply(option.id)}>
                Use this alternative
              </button>
            </article>
          ))}
        </div>
      )}
      {suggestion?.kind === "recipe_link" && (
        <div className="plan-suggestion-list">
          {suggestion.payload.recipeLinks.map((option) => (
            <article key={option.id}>
              <h5>{option.title}</h5>
              <p>{option.evidenceSummary}</p>
              <small>
                {option.domain}
                {option.prepMinutes != null ? ` · ${option.prepMinutes} min` : ""}
                {option.yieldText ? ` · ${option.yieldText}` : ""}
              </small>
              <details>
                <summary>Recipe ingredients ({option.ingredients.length})</summary>
                <ul>
                  {option.ingredients.map((ingredient, index) => (
                    <li key={`${ingredient.item}-${index}`}>
                      {ingredient.quantity != null ? `${ingredient.quantity} ` : ""}
                      {ingredient.unit ? `${ingredient.unit} ` : ""}
                      {ingredient.item}
                      {ingredient.optional ? " (optional)" : ""}
                    </li>
                  ))}
                </ul>
              </details>
              <em>Shopping: {option.shoppingImpact}</em>
              {option.shopping.length > 0 ? (
                <details open>
                  <summary>Will add or update ({option.shopping.length})</summary>
                  <ul>
                    {option.shopping.map((line) => (
                      <li key={line.id}>
                        {line.quantity != null ? `${line.quantity} ` : ""}
                        {line.unit ? `${line.unit} ` : ""}
                        {line.item}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <p className="muted">No additional shopping is expected from this recipe.</p>
              )}
              {option.warnings.length > 0 && (
                <ul>
                  {option.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              <a href={option.url} target="_blank" rel="noreferrer">
                Open source ↗
              </a>
              <button className="primary-button" disabled={busy} onClick={() => apply(option.id)}>
                Attach recipe and shopping
              </button>
            </article>
          ))}
        </div>
      )}
      {check && (
        <div className={`recipe-check-result ${check.verified ? "verified" : "warning"}`}>
          <strong>
            {check.verified ? "Exact source verified" : `Source check: ${check.check.matchStatus}`}
          </strong>
          <p>{check.check.evidenceSummary}</p>
          <small>
            {check.check.pageTitle ?? "Unknown page title"}
            {check.check.prepMinutes != null ? ` · ${check.check.prepMinutes} min` : ""}
            {check.check.yieldText ? ` · ${check.check.yieldText}` : ""}
          </small>
          {check.check.warnings.length > 0 && (
            <ul>
              {check.check.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
