"use client";

import type { WeeklyPlan } from "@/lib/ai/contracts";
import type {
  HouseholdUserRecord,
  InventoryRecord,
  RecipeRecord,
  UnscheduledRecord,
  WeeklyPlanRecord,
} from "@/lib/db/queries";
import { WeeklyPlanRefinement } from "@/components/weekly-plan-refinement";
import { formatDateKey } from "@/lib/datetime";
import { formatQuantity } from "@/lib/format";
import type {
  CoverageException,
  IngredientRequirement,
  InventorySearchState,
  Meal,
  SetInventorySearchFn,
  ShoppingDecision,
  ShoppingLine,
} from "./types";

import { WeeklyPlanDayView } from "./weekly-plan-day-view";
import { WeeklyPlanEditor } from "./weekly-plan-editor";
import { WeeklyPlanSavingsBanner } from "./weekly-plan-savings-banner";
import { WeeklyPlanScorecard } from "./weekly-plan-scorecard";

interface WeeklyPlanCardProps {
  plan: WeeklyPlanRecord;
  editId: string | null;
  draft: WeeklyPlan | null;
  users: HouseholdUserRecord[];
  recipes: RecipeRecord[];
  unscheduled: UnscheduledRecord[];
  inventory: InventoryRecord[];
  timeZone: string;
  busy: boolean;
  deepModel: string;
  balancedModel: string;
  routineModel: string;
  fallbackModel: string;
  inventorySearch: InventorySearchState | null;
  replaceExisting: Record<string, boolean>;
  restoreRevision: Record<string, string>;
  setInventorySearch: SetInventorySearchFn;
  setReplaceExisting: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setRestoreRevision: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setDraft: React.Dispatch<React.SetStateAction<WeeklyPlan | null>>;
  onBeginEdit: (plan: WeeklyPlanRecord) => void;
  onCancelEdit: () => void;
  onSave: (planId: string) => void;
  onDecide: (planId: string, action: "commit" | "reject") => void;
  onArchive: (planId: string) => void;
  onRestore: (planId: string) => void;
  updateMeal: (index: number, patch: Partial<Meal>) => void;
  updateRequirement: (
    mealIndex: number,
    requirementIndex: number,
    patch: Partial<IngredientRequirement>,
  ) => void;
  updateException: (index: number, patch: Partial<CoverageException>) => void;
  updateShopping: (index: number, patch: Partial<ShoppingLine>) => void;
  setShoppingDecision: (
    line: ShoppingLine,
    action: ShoppingDecision["action"],
    inventoryEntryId: string | null,
  ) => void;
  undoShoppingDecision: (requirementKey: string) => void;
}

export function WeeklyPlanCard({
  plan,
  editId,
  draft,
  users,
  recipes,
  unscheduled,
  inventory,
  timeZone,
  busy,
  deepModel,
  balancedModel,
  routineModel,
  fallbackModel,
  inventorySearch,
  replaceExisting,
  restoreRevision,
  setInventorySearch,
  setReplaceExisting,
  setRestoreRevision,
  setDraft,
  onBeginEdit,
  onCancelEdit,
  onSave,
  onDecide,
  onArchive,
  onRestore,
  updateMeal,
  updateRequirement,
  updateException,
  updateShopping,
  setShoppingDecision,
  undoShoppingDecision,
}: WeeklyPlanCardProps) {
  const editing = editId === plan.id && draft !== null;
  const payload = editing ? draft! : plan.payload;
  const errors = plan.issues.filter((issue) => issue.severity === "error");
  const warnings = plan.issues.filter((issue) => issue.severity === "warning");

  return (
    <article className={`weekly-plan-card ${plan.status}`} key={plan.id}>
      <header>
        <div>
          <span className="eyebrow">
            {plan.startDate} → {plan.endDate}
          </span>
          <h3>{payload.title}</h3>
          <p>{payload.summary}</p>
        </div>
        <span
          className={`status-chip ${plan.status === "draft" && !errors.length ? "ready" : "warning"}`}
        >
          {plan.status} · v{plan.revisionNumber}
        </span>
      </header>

      <p className="plan-strategy">{payload.strategy}</p>

      <WeeklyPlanSavingsBanner payload={payload} />
      <WeeklyPlanScorecard payload={payload} />

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="plan-issues">
          {errors.length > 0 && (
            <div>
              <strong>
                {errors.length} blocking issue{errors.length === 1 ? "" : "s"}
              </strong>
              <ul>
                {errors.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <details>
              <summary>
                {warnings.length} warning{warnings.length === 1 ? "" : "s"}
              </summary>
              <ul>
                {warnings.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {!editing && (
        <WeeklyPlanRefinement
          plan={plan}
          recipes={recipes}
          routineModel={routineModel}
          fallbackModel={fallbackModel}
        />
      )}

      {editing ? (
        <WeeklyPlanEditor
          plan={plan}
          payload={payload}
          users={users}
          recipes={recipes}
          unscheduled={unscheduled}
          inventory={inventory}
          busy={busy}
          inventorySearch={inventorySearch}
          setInventorySearch={setInventorySearch}
          setDraft={setDraft}
          updateMeal={updateMeal}
          updateRequirement={updateRequirement}
          updateException={updateException}
          updateShopping={updateShopping}
          setShoppingDecision={setShoppingDecision}
          undoShoppingDecision={undoShoppingDecision}
          onCancel={onCancelEdit}
          onSave={onSave}
        />
      ) : (
        <>
          <WeeklyPlanDayView plan={plan} payload={payload} users={users} />

          {payload.prepTasks.length > 0 && (
            <div className="plan-prep-preview">
              <h4>Prep roadmap</h4>
              <ul>
                {payload.prepTasks.map((task) => (
                  <li key={task.id}>
                    <span>
                      {formatDateKey(task.mealDate, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <strong>{task.task}</strong>
                    <small>{task.minutes} min</small>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="plan-shopping-preview">
            <h4>Proposed shopping · {payload.shopping.length}</h4>
            {payload.shopping.length ? (
              <ul>
                {payload.shopping.map((item) => (
                  <li key={item.id}>
                    <strong>{item.item}</strong>
                    <span>
                      {formatQuantity(item.quantity)} {item.unit ?? ""}
                    </span>
                    <small>
                      {item.reason}
                      {item.suggestedStore
                        ? ` · ${item.suggestedStore}${item.estimatedPrice != null ? ` · $${item.estimatedPrice.toFixed(2)}` : ""}`
                        : ""}
                    </small>
                    {item.saleItemId && <em>Verified flyer sale</em>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No additional shopping proposed.</p>
            )}
            {payload.shoppingDecisions.length > 0 && (
              <div className="plan-shopping-decisions">
                <strong>Reviewed ingredient decisions</strong>
                {payload.shoppingDecisions.map((decision) => {
                  const linkedInventory = decision.inventoryEntryId
                    ? inventory.find((entry) => entry.id === decision.inventoryEntryId)
                    : null;
                  return (
                    <span key={decision.requirementKey}>
                      <strong>{decision.item}</strong>
                      {decision.action === "inventory"
                        ? ` covered by ${linkedInventory?.ingredient ?? "unavailable inventory"}${linkedInventory?.brandVariety ? ` · ${linkedInventory.brandVariety}` : ""}`
                        : " manually excluded from this draft"}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <footer className="weekly-plan-footer">
        <div className="ai-run-meta">
          <span>
            {plan.modelTier === "balanced"
              ? "Balanced planning"
              : plan.modelTier === "planning"
                ? "Deep planning"
                : plan.modelTier === "fallback"
                  ? "Deep fallback"
                  : "AI"}{" "}
            · {plan.model ?? (plan.modelTier === "planning" ? deepModel : balancedModel)}
          </span>
          {plan.totalTokens != null && (
            <span>{plan.totalTokens.toLocaleString()} tokens</span>
          )}
          {plan.discoverRecipes && (
            <span>
              {plan.webSearchCalls ?? 0} web search call
              {plan.webSearchCalls === 1 ? "" : "s"} · {plan.recipeSources.length} verified
              recipe source{plan.recipeSources.length === 1 ? "" : "s"}
            </span>
          )}
          {plan.estimatedCostUsd && (
            <span>Retail estimate ${Number(plan.estimatedCostUsd).toFixed(4)} USD</span>
          )}
        </div>
        {plan.status === "draft" && !editing && (
          <>
            <div className="revision-tools">
              <label>
                History
                <select
                  value={restoreRevision[plan.id] ?? ""}
                  onChange={(event) =>
                    setRestoreRevision((current) => ({
                      ...current,
                      [plan.id]: event.target.value,
                    }))
                  }
                >
                  <option value="">Choose revision</option>
                  {plan.revisions.map((revision) => (
                    <option key={revision.revisionNumber} value={revision.revisionNumber}>
                      v{revision.revisionNumber} · {revision.summary}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || !restoreRevision[plan.id]}
                onClick={() => onRestore(plan.id)}
              >
                Restore as new revision
              </button>
            </div>
            <details className="revision-history">
              <summary>What changed in each revision</summary>
              <ol>
                {plan.revisions.map((revision) => (
                  <li key={revision.revisionNumber}>
                    <strong>
                      v{revision.revisionNumber} · {revision.summary}
                    </strong>
                    <small>
                      {revision.source} ·{" "}
                      {new Date(revision.createdAt).toLocaleString("en-CA", { timeZone })}
                    </small>
                    {Object.keys(revision.changeDetail).length > 0 && (
                      <code>{JSON.stringify(revision.changeDetail)}</code>
                    )}
                  </li>
                ))}
              </ol>
            </details>
            <label className="checkbox-label replace-plan">
              <input
                type="checkbox"
                checked={Boolean(replaceExisting[plan.id])}
                onChange={(event) =>
                  setReplaceExisting((current) => ({
                    ...current,
                    [plan.id]: event.target.checked,
                  }))
                }
              />
              Replace conflicting existing Planned meals when committing
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="danger-link"
                disabled={busy}
                onClick={() => onArchive(plan.id)}
              >
                Archive proposal
              </button>
              <button
                type="button"
                className="danger-link"
                disabled={busy}
                onClick={() => onDecide(plan.id, "reject")}
              >
                Reject plan
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => onBeginEdit(plan)}
              >
                Edit plan
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy || errors.length > 0}
                onClick={() => onDecide(plan.id, "commit")}
              >
                Commit calendar and shopping
              </button>
            </div>
          </>
        )}
        {plan.status !== "draft" && plan.status !== "committed" && (
          <div className="form-actions">
            <button
              type="button"
              className="danger-link"
              disabled={busy}
              onClick={() => onArchive(plan.id)}
            >
              Archive proposal
            </button>
          </div>
        )}
      </footer>
    </article>
  );
}
