"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { WeeklyPlan } from "@/lib/ai/contracts";
import type {
  HouseholdUserRecord,
  RecipeRecord,
  UnscheduledRecord,
  WeeklyPlanJobRecord,
  WeeklyPlanRecord,
} from "@/lib/db/queries";
import { WeeklyPlanRefinement } from "@/components/weekly-plan-refinement";
import { formatDateKey, householdDateKey } from "@/lib/datetime";
import { formatQuantity } from "@/lib/format";
import { MEAL_TYPES, optionLabel } from "@/lib/options";

type Meal = WeeklyPlan["meals"][number];
type CoverageException = WeeklyPlan["coverageExceptions"][number];
type ShoppingLine = WeeklyPlan["shopping"][number];
type IngredientRequirement = Meal["ingredientRequirements"][number];

function defaultWindow(timeZone: string) {
  const today = householdDateKey(new Date(), timeZone);
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + ((6 - date.getUTCDay() + 7) % 7));
  const start = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 7);
  return { start, end: date.toISOString().slice(0, 10) };
}

function blankMeal(plan: WeeklyPlanRecord): Meal {
  return {
    id: `manual-${Date.now()}`,
    mealDate: plan.startDate,
    mealType: "breakfast",
    assignedUserId: null,
    dish: "New meal",
    cuisine: "Flexible",
    technique: "assembly",
    primaryIngredients: [],
    preparationBasis: "assembly",
    preparationMethod: "Assemble the listed ingredients and season to taste.",
    ingredientRequirements: [],
    saleItemIds: [],
    discovery: false,
    recipeId: null,
    recipeTitle: null,
    recipeUrl: null,
    servings: 2,
    leftoverServings: 0,
    leftoverFromMealId: null,
    packedLunch: false,
    workplaceMeal: false,
    workplaceFriendly: true,
    intensity: "moderate",
    prepMinutes: 20,
    plannedYield: "2 servings",
    rationale: "Added during plan review.",
    notes: null,
    unscheduledItemId: null,
    inventoryUses: [],
  };
}

function blankException(plan: WeeklyPlanRecord, userId: string): CoverageException {
  return {
    id: `exception-${Date.now()}`,
    mealDate: plan.startDate,
    mealType: "breakfast",
    userId,
    reason: "No meal is needed.",
  };
}

function blankShopping(): ShoppingLine {
  return {
    id: `shopping-${Date.now()}`,
    item: "New item",
    category: "Other",
    quantity: 1,
    unit: "each",
    reason: "Needed for the reviewed weekly plan.",
    mealIds: [],
    suggestedStore: null,
    saleItemId: null,
    estimatedPrice: null,
  };
}

function jobStageLabel(job: WeeklyPlanJobRecord) {
  if (job.status === "queued") return "Queued";
  if (job.status === "completed") return "Draft ready";
  if (job.status === "cancelled") return "Cancelled";
  if (job.status === "failed") return "Generation failed";
  if (job.stage === "normalizing") return "Normalizing notes";
  if (job.stage === "loading_context") return "Loading household context";
  if (job.stage === "discovering_recipes") return "Planning and verifying recipe sources";
  if (job.stage === "fallback_planning") return "Deep Sol timed out; Terra is finishing the plan";
  if (job.stage === "validating") return "Validating the draft";
  return job.planningMode === "deep"
    ? "Sol is deeply planning the week"
    : "Terra is planning the week";
}

export function WeeklyPlanner({
  plans,
  planningJobs,
  users,
  recipes,
  unscheduled,
  timeZone,
  aiConfigured,
  balancedModel,
  deepModel,
  deepEffort,
  routineModel,
  fallbackModel,
}: {
  plans: WeeklyPlanRecord[];
  planningJobs: WeeklyPlanJobRecord[];
  users: HouseholdUserRecord[];
  recipes: RecipeRecord[];
  unscheduled: UnscheduledRecord[];
  timeZone: string;
  aiConfigured: boolean;
  balancedModel: string;
  deepModel: string;
  deepEffort: string;
  routineModel: string;
  fallbackModel: string;
}) {
  const router = useRouter();
  const defaults = useMemo(() => defaultWindow(timeZone), [timeZone]);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [startMeal, setStartMeal] = useState("lunch");
  const [endMeal, setEndMeal] = useState("breakfast");
  const [notes, setNotes] = useState("");
  const [includeSnacks, setIncludeSnacks] = useState(true);
  const [includeDesserts, setIncludeDesserts] = useState(true);
  const [discoverRecipes, setDiscoverRecipes] = useState(true);
  const [planningMode, setPlanningMode] = useState<"balanced" | "deep">("balanced");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WeeklyPlan | null>(null);
  const [replaceExisting, setReplaceExisting] = useState<Record<string, boolean>>({});
  const [restoreRevision, setRestoreRevision] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState(planningJobs);
  const [clock, setClock] = useState(Date.now());
  const availableUnscheduled = unscheduled.filter((item) =>
    ["planned", "open", "unconfirmed"].includes(item.status),
  );
  const activeJobIds = useMemo(
    () =>
      jobs
        .filter((job) => job.status === "queued" || job.status === "running")
        .map((job) => job.id)
        .sort()
        .join(","),
    [jobs],
  );
  const hasActiveJob = Boolean(activeJobIds);

  useEffect(() => setJobs(planningJobs), [planningJobs]);
  useEffect(() => {
    if (!activeJobIds) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeJobIds]);
  useEffect(() => {
    if (!activeJobIds) return;
    let cancelled = false;
    async function poll() {
      const ids = activeJobIds.split(",").filter(Boolean);
      const updates = await Promise.all(
        ids.map(async (id) => {
          const response = await fetch(`/api/v1/weekly-plans/jobs/${id}`, { cache: "no-store" });
          if (!response.ok) return null;
          const payload = await response.json();
          return payload.job as WeeklyPlanJobRecord;
        }),
      );
      if (cancelled) return;
      const completed = updates.some((job) => job?.status === "completed");
      const failed = updates.find((job) => job?.status === "failed");
      setJobs((current) =>
        current.map((job) => updates.find((update) => update?.id === job.id) ?? job),
      );
      if (failed) setError(failed.errorMessage ?? "Weekly planning failed.");
      if (completed) {
        setMessage("A new weekly plan is ready for review.");
        router.refresh();
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeJobIds, router]);

  async function request(path: string, method: string, body?: unknown) {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Weekly planning request failed.");
    return payload;
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await request("/api/v1/weekly-plans", "POST", {
        startDate,
        endDate,
        startMeal,
        endMeal,
        planningMode,
        notes,
        includeSnacks,
        includeDesserts,
        discoverRecipes,
      });
      setJobs((current) =>
        [
          result.job as WeeklyPlanJobRecord,
          ...current.filter((job) => job.id !== result.job.id),
        ].slice(0, 5),
      );
      setMessage(
        "Weekly planning has started in the background. You can leave this page and return later.",
      );
      setNotes("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not generate the plan.");
    } finally {
      setBusy(false);
    }
  }

  async function jobAction(job: WeeklyPlanJobRecord, action: "cancel" | "retry" | "dismiss") {
    setBusy(true);
    setError("");
    try {
      const result = await request(`/api/v1/weekly-plans/jobs/${job.id}/${action}`, "POST");
      setJobs((current) =>
        action === "retry"
          ? [result.job, ...current.filter((entry) => entry.id !== job.id)].slice(0, 5)
          : action === "dismiss"
            ? current.filter((entry) => entry.id !== job.id)
            : current.map((entry) => (entry.id === job.id ? result.job : entry)),
      );
      setMessage(
        action === "retry"
          ? "Weekly planning was queued again."
          : action === "dismiss"
            ? "The failed planning attempt was dismissed. Its usage and diagnostics are preserved."
            : "Weekly planning was cancelled.",
      );
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not update the planning job.");
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(plan: WeeklyPlanRecord) {
    setEditId(plan.id);
    setDraft(structuredClone(plan.payload));
    setError("");
    setMessage("");
  }
  function updateMeal(index: number, patch: Partial<Meal>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            meals: current.meals.map((meal, mealIndex) =>
              mealIndex === index ? { ...meal, ...patch } : meal,
            ),
          }
        : current,
    );
  }
  function updateRequirement(
    mealIndex: number,
    requirementIndex: number,
    patch: Partial<IngredientRequirement>,
  ) {
    setDraft((current) =>
      current
        ? {
            ...current,
            meals: current.meals.map((meal, index) =>
              index === mealIndex
                ? {
                    ...meal,
                    ingredientRequirements: meal.ingredientRequirements.map(
                      (requirement, innerIndex) =>
                        innerIndex === requirementIndex
                          ? { ...requirement, ...patch }
                          : requirement,
                    ),
                  }
                : meal,
            ),
          }
        : current,
    );
  }
  function updateException(index: number, patch: Partial<CoverageException>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            coverageExceptions: current.coverageExceptions.map((entry, entryIndex) =>
              entryIndex === index ? { ...entry, ...patch } : entry,
            ),
          }
        : current,
    );
  }
  function updateShopping(index: number, patch: Partial<ShoppingLine>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            shopping: current.shopping.map((item, itemIndex) =>
              itemIndex === index ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
  }

  async function save(planId: string) {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/v1/weekly-plans/${planId}`, "PATCH", { payload: draft });
      setEditId(null);
      setDraft(null);
      setMessage("Weekly-plan revision saved and revalidated.");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save the revision.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(planId: string, action: "commit" | "reject") {
    setBusy(true);
    setError("");
    try {
      const result = await request(
        `/api/v1/weekly-plans/${planId}/${action}`,
        "POST",
        action === "commit" ? { replaceExisting: Boolean(replaceExisting[planId]) } : undefined,
      );
      setMessage(
        action === "commit"
          ? `Committed ${result.mealCount} meals, ${result.prepTaskCount} prep tasks and ${result.shoppingCreated} new shopping items.`
          : "Weekly plan rejected.",
      );
      if (editId === planId) {
        setEditId(null);
        setDraft(null);
      }
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not update the plan.");
    } finally {
      setBusy(false);
    }
  }

  async function archivePlan(planId: string) {
    setBusy(true);
    setError("");
    try {
      await request(`/api/v1/weekly-plans/${planId}/archive`, "POST");
      if (editId === planId) {
        setEditId(null);
        setDraft(null);
      }
      setMessage("Proposed weekly plan archived. Its revisions and audit history are retained.");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not archive the weekly plan.");
    } finally {
      setBusy(false);
    }
  }

  async function restore(planId: string) {
    const revision = Number(restoreRevision[planId]);
    if (!revision) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/v1/weekly-plans/${planId}/restore`, "POST", { revisionNumber: revision });
      setMessage(`Revision ${revision} restored as a new revision.`);
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not restore the revision.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section-card weekly-planner">
      <header>
        <div>
          <span className="eyebrow">Household-aware weekly planning</span>
          <h2>Generate a complete household week</h2>
          <p className="muted">
            Choose balanced Terra for normal weeks or opt into deep Sol when the week warrants
            maximum consideration. Both use the same inventory, preferences, feedback, recipes,
            flyers and deterministic review checks.
          </p>
        </div>
        <span className={`status-chip ${aiConfigured ? "ready" : "warning"}`}>
          {aiConfigured ? "AI ready" : "Setup required"}
        </span>
      </header>

      {jobs.length > 0 && (
        <div className="weekly-planning-jobs" aria-live="polite">
          {jobs.map((job) => {
            const elapsed =
              job.startedAt && ["running", "cancelled", "failed", "completed"].includes(job.status)
                ? Math.max(
                    0,
                    Math.floor(
                      ((job.completedAt ? new Date(job.completedAt).getTime() : clock) -
                        new Date(job.startedAt).getTime()) /
                        1000,
                    ),
                  )
                : null;
            const search = job.webSearchEnabled
              ? job.webSearchCalls != null
                ? `Live recipe search · ${job.webSearchCalls} call${job.webSearchCalls === 1 ? "" : "s"}`
                : "Live recipe search enabled"
              : "Saved recipes only";
            const defaultModel = job.planningMode === "deep" ? deepModel : balancedModel;
            return (
              <div className={`weekly-planning-job ${job.status}`} key={job.id}>
                <span>
                  <strong>
                    {job.startDate} to {job.endDate}
                  </strong>
                  <small>
                    {jobStageLabel(job)}
                    {elapsed != null ? ` · ${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : ""}
                  </small>
                  <small>
                    {job.planningMode === "deep" ? "Deep" : "Balanced"} ·{" "}
                    {job.model ?? defaultModel} · {search}
                  </small>
                </span>
                <span
                  className={`status-chip ${job.status === "failed" || job.status === "cancelled" ? "warning" : job.status === "completed" ? "ready" : ""}`}
                >
                  {job.status}
                </span>
                {["queued", "running"].includes(job.status) && (
                  <button
                    type="button"
                    className="danger-link"
                    disabled={busy}
                    onClick={() => jobAction(job, "cancel")}
                  >
                    Cancel
                  </button>
                )}
                {["failed", "cancelled"].includes(job.status) && (
                  <div className="weekly-planning-job-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || hasActiveJob}
                      onClick={() => jobAction(job, "retry")}
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      className="danger-link"
                      disabled={busy}
                      onClick={() => jobAction(job, "dismiss")}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                {job.status === "failed" && job.errorMessage && (
                  <p className="form-error">{job.errorMessage}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <form className="weekly-plan-request" onSubmit={generate}>
        <div className="form-grid">
          <label>
            First date
            <input
              type="date"
              required
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label>
            First meal
            <select value={startMeal} onChange={(event) => setStartMeal(event.target.value)}>
              <option value="breakfast">Breakfast</option>
              <option value="lunch">Lunch</option>
              <option value="dinner">Dinner</option>
            </select>
          </label>
          <label>
            Final date
            <input
              type="date"
              required
              min={startDate}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <label>
            Final meal
            <select value={endMeal} onChange={(event) => setEndMeal(event.target.value)}>
              <option value="breakfast">Breakfast</option>
              <option value="lunch">Lunch</option>
              <option value="dinner">Dinner</option>
            </select>
          </label>
          <label className="span-two">
            Planning depth
            <select
              value={planningMode}
              onChange={(event) => setPlanningMode(event.target.value as "balanced" | "deep")}
            >
              <option value="balanced">Balanced · Terra at medium reasoning (recommended)</option>
              <option value="deep">Deep · Sol at {deepEffort} reasoning</option>
            </select>
          </label>
          <label className="span-two">
            This week&apos;s exceptions, requests and sale specials
            <textarea
              maxLength={8000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Example: One person is out Thursday evening. Use two use-soon vegetables. Tofu is on sale. Keep Tuesday especially light."
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeSnacks}
              onChange={(event) => setIncludeSnacks(event.target.checked)}
            />
            Plan useful snacks
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeDesserts}
              onChange={(event) => setIncludeDesserts(event.target.checked)}
            />
            Include desserts
          </label>
          <label className="checkbox-label span-two">
            <input
              type="checkbox"
              checked={discoverRecipes}
              onChange={(event) => setDiscoverRecipes(event.target.checked)}
            />
            Find and verify live recipe links
          </label>
        </div>
        <div className="planning-cost-note">
          <strong>{planningMode === "deep" ? "Deep planning" : "Balanced planning"}:</strong>{" "}
          {planningMode === "deep"
            ? `${deepModel} uses ${deepEffort} reasoning with a 48,000-token response ceiling. If it times out, Terra may finish the same durable job.`
            : `${balancedModel} uses medium reasoning with a 32,000-token response ceiling and never escalates to Sol automatically.`}{" "}
          The ceiling includes reasoning and the final plan but is not preallocated usage. Live
          discovery searches only when enabled. You may leave the page while the background job
          continues.
        </div>
        {error && <p className="form-error">{error}</p>}
        {message && <p className="form-success">{message}</p>}
        <div className="form-actions">
          <button className="primary-button" disabled={!aiConfigured || busy || hasActiveJob}>
            {busy
              ? "Queuing the week…"
              : hasActiveJob
                ? "Planning in background…"
                : `Generate ${planningMode === "deep" ? "deep Sol" : "balanced Terra"} plan`}
          </button>
        </div>
      </form>

      <div className="weekly-plan-list">
        {plans.map((plan) => {
          const editing = editId === plan.id && draft !== null;
          const payload = editing ? draft! : plan.payload;
          const errors = plan.issues.filter((issue) => issue.severity === "error");
          const warnings = plan.issues.filter((issue) => issue.severity === "warning");
          const grouped = Map.groupBy(payload.meals, (meal) => meal.mealDate);
          const planDates = [
            ...new Set([
              ...payload.meals.map((meal) => meal.mealDate),
              ...payload.coverageExceptions.map((entry) => entry.mealDate),
            ]),
          ].sort();

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
              {payload.planFormatVersion >= 2 && (
                <div className="plan-scorecard">
                  <div>
                    <strong>{payload.reviewScorecard.saleItemIdsUsed.length}</strong>
                    <span>sale opportunities used</span>
                    <small>
                      {payload.reviewScorecard.qualifiedSalesConsidered} ranked ·{" "}
                      {payload.reviewScorecard.prioritySalesConsidered} prioritized
                    </small>
                  </div>
                  <div>
                    <strong>
                      {payload.reviewScorecard.useNowInventoryIdsUsed.length +
                        payload.reviewScorecard.useSoonInventoryIdsUsed.length}
                    </strong>
                    <span>priority inventory items used</span>
                    <small>
                      {payload.reviewScorecard.useNowInventoryIdsUsed.length} use now ·{" "}
                      {payload.reviewScorecard.useSoonInventoryIdsUsed.length} use soon
                    </small>
                  </div>
                  <div>
                    <strong>
                      {payload.reviewScorecard.cuisines.length} /{" "}
                      {payload.reviewScorecard.techniques.length}
                    </strong>
                    <span>cuisines / techniques</span>
                    <small>
                      {payload.reviewScorecard.primaryIngredients.length} primary ingredients
                    </small>
                  </div>
                  <div>
                    <strong>{payload.reviewScorecard.discoveryMealIds.length}</strong>
                    <span>discovery meals</span>
                    <small>
                      {payload.reviewScorecard.familiarMealIds.length} familiar meals ·{" "}
                      {payload.reviewScorecard.recentRepeats.length} recent repeats
                    </small>
                  </div>
                </div>
              )}
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
                <div className="weekly-plan-editor">
                  <div className="plan-overview-edit form-grid">
                    <label className="span-two">
                      Plan title
                      <input
                        value={payload.title}
                        onChange={(event) =>
                          setDraft((current) =>
                            current ? { ...current, title: event.target.value } : current,
                          )
                        }
                      />
                    </label>
                    <label className="span-two">
                      Summary
                      <textarea
                        value={payload.summary}
                        onChange={(event) =>
                          setDraft((current) =>
                            current ? { ...current, summary: event.target.value } : current,
                          )
                        }
                      />
                    </label>
                    <label className="span-two">
                      Strategy
                      <textarea
                        value={payload.strategy}
                        onChange={(event) =>
                          setDraft((current) =>
                            current ? { ...current, strategy: event.target.value } : current,
                          )
                        }
                      />
                    </label>
                    <label className="span-two">
                      Planner warnings, one per line
                      <textarea
                        value={payload.warnings.join("\n")}
                        onChange={(event) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  warnings: event.target.value
                                    .split("\n")
                                    .map((line) => line.trim())
                                    .filter(Boolean),
                                }
                              : current,
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className="editor-toolbar">
                    <strong>Editing revision {plan.revisionNumber + 1}</strong>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        setDraft((current) =>
                          current
                            ? { ...current, meals: [...current.meals, blankMeal(plan)] }
                            : current,
                        )
                      }
                    >
                      Add meal
                    </button>
                  </div>
                  {payload.meals.map((meal, index) => (
                    <div className="plan-meal-edit" key={meal.id}>
                      <div className="plan-meal-edit-grid">
                        <label>
                          Date
                          <input
                            type="date"
                            min={plan.startDate}
                            max={plan.endDate}
                            value={meal.mealDate}
                            onChange={(event) =>
                              updateMeal(index, { mealDate: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          Meal
                          <select
                            value={meal.mealType}
                            onChange={(event) =>
                              updateMeal(index, {
                                mealType: event.target.value as Meal["mealType"],
                              })
                            }
                          >
                            {MEAL_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {optionLabel(type)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          For
                          <select
                            value={meal.assignedUserId ?? ""}
                            onChange={(event) =>
                              updateMeal(index, { assignedUserId: event.target.value || null })
                            }
                          >
                            <option value="">Household</option>
                            {users.map((user) => (
                              <option value={user.id} key={user.id}>
                                {user.displayName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="span-two">
                          Dish
                          <input
                            value={meal.dish}
                            onChange={(event) => updateMeal(index, { dish: event.target.value })}
                          />
                        </label>
                        <label>
                          Cuisine
                          <input
                            value={meal.cuisine}
                            onChange={(event) => updateMeal(index, { cuisine: event.target.value })}
                          />
                        </label>
                        <label>
                          Technique
                          <input
                            value={meal.technique}
                            onChange={(event) =>
                              updateMeal(index, { technique: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          Preparation basis
                          <select
                            value={meal.preparationBasis}
                            onChange={(event) =>
                              updateMeal(index, {
                                preparationBasis: event.target.value as Meal["preparationBasis"],
                              })
                            }
                          >
                            <option value="saved_recipe">Saved recipe</option>
                            <option value="verified_recipe">Verified recipe</option>
                            <option value="guided_method">Guided method</option>
                            <option value="assembly">Assembly</option>
                            <option value="prepared_food">Prepared food</option>
                            <option value="leftover">Leftover</option>
                          </select>
                        </label>
                        <label className="span-two">
                          Primary ingredients
                          <input
                            value={meal.primaryIngredients.join(", ")}
                            onChange={(event) =>
                              updateMeal(index, {
                                primaryIngredients: event.target.value
                                  .split(",")
                                  .map((value) => value.trim())
                                  .filter(Boolean)
                                  .slice(0, 12),
                              })
                            }
                          />
                        </label>
                        <label>
                          Servings
                          <input
                            type="number"
                            min="1"
                            max="40"
                            value={meal.servings}
                            onChange={(event) =>
                              updateMeal(index, { servings: Number(event.target.value) })
                            }
                          />
                        </label>
                        <label>
                          Reserve leftovers
                          <input
                            type="number"
                            min="0"
                            max="40"
                            value={meal.leftoverServings}
                            onChange={(event) =>
                              updateMeal(index, { leftoverServings: Number(event.target.value) })
                            }
                          />
                        </label>
                        <label>
                          Use leftovers from
                          <select
                            value={meal.leftoverFromMealId ?? ""}
                            onChange={(event) =>
                              updateMeal(index, { leftoverFromMealId: event.target.value || null })
                            }
                          >
                            <option value="">Not leftovers</option>
                            {payload.meals
                              .filter(
                                (source) =>
                                  source.id !== meal.id && source.mealDate < meal.mealDate,
                              )
                              .map((source) => (
                                <option value={source.id} key={source.id}>
                                  {source.mealDate} · {source.dish}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          Prep minutes
                          <input
                            type="number"
                            min="0"
                            max="720"
                            value={meal.prepMinutes}
                            onChange={(event) =>
                              updateMeal(index, { prepMinutes: Number(event.target.value) })
                            }
                          />
                        </label>
                        <label>
                          Intensity
                          <select
                            value={meal.intensity}
                            onChange={(event) =>
                              updateMeal(index, {
                                intensity: event.target.value as Meal["intensity"],
                              })
                            }
                          >
                            <option value="light">Light</option>
                            <option value="moderate">Moderate</option>
                            <option value="substantial">Substantial</option>
                          </select>
                        </label>
                        <label>
                          Yield
                          <input
                            value={meal.plannedYield}
                            onChange={(event) =>
                              updateMeal(index, { plannedYield: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          Saved recipe
                          <select
                            value={meal.recipeId ?? ""}
                            onChange={(event) => {
                              const recipe = recipes.find(
                                (entry) => entry.id === event.target.value,
                              );
                              updateMeal(
                                index,
                                recipe
                                  ? {
                                      recipeId: recipe.id,
                                      recipeTitle: recipe.title,
                                      recipeUrl: recipe.sourceUrl,
                                      plannedYield: recipe.plannedYield ?? meal.plannedYield,
                                      preparationBasis: "saved_recipe",
                                    }
                                  : { recipeId: null },
                              );
                            }}
                          >
                            <option value="">Not linked</option>
                            {recipes
                              .filter((recipe) => recipe.recipeStatus !== "avoid")
                              .map((recipe) => (
                                <option key={recipe.id} value={recipe.id}>
                                  {recipe.title}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          Recipe title
                          <input
                            value={meal.recipeTitle ?? ""}
                            onChange={(event) =>
                              updateMeal(index, { recipeTitle: event.target.value || null })
                            }
                          />
                        </label>
                        <label className="span-two">
                          Recipe URL
                          <input
                            type="url"
                            value={meal.recipeUrl ?? ""}
                            onChange={(event) =>
                              updateMeal(index, { recipeUrl: event.target.value || null })
                            }
                          />
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={meal.packedLunch}
                            onChange={(event) =>
                              updateMeal(index, { packedLunch: event.target.checked })
                            }
                          />
                          Packed lunch
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={meal.workplaceMeal}
                            onChange={(event) =>
                              updateMeal(index, { workplaceMeal: event.target.checked })
                            }
                          />
                          Workplace meal
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={meal.workplaceFriendly}
                            onChange={(event) =>
                              updateMeal(index, { workplaceFriendly: event.target.checked })
                            }
                          />
                          Workplace-friendly
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={meal.discovery}
                            onChange={(event) =>
                              updateMeal(index, { discovery: event.target.checked })
                            }
                          />
                          New discovery
                        </label>
                        <label className="span-two">
                          Linked Unscheduled item
                          <select
                            value={meal.unscheduledItemId ?? ""}
                            onChange={(event) =>
                              updateMeal(index, { unscheduledItemId: event.target.value || null })
                            }
                          >
                            <option value="">Not linked</option>
                            {availableUnscheduled.map((item) => (
                              <option value={item.id} key={item.id}>
                                {item.title} · week of {item.weekStart}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="span-two">
                          Preparation method
                          <textarea
                            value={meal.preparationMethod ?? ""}
                            onChange={(event) =>
                              updateMeal(index, { preparationMethod: event.target.value || null })
                            }
                          />
                        </label>
                        <label className="span-two">
                          Rationale
                          <textarea
                            value={meal.rationale}
                            onChange={(event) =>
                              updateMeal(index, { rationale: event.target.value })
                            }
                          />
                        </label>
                        <label className="span-two">
                          Notes
                          <textarea
                            value={meal.notes ?? ""}
                            onChange={(event) =>
                              updateMeal(index, { notes: event.target.value || null })
                            }
                          />
                        </label>
                      </div>
                      <div className="meal-requirement-editor">
                        <header>
                          <strong>Complete ingredients</strong>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              updateMeal(index, {
                                ingredientRequirements: [
                                  ...meal.ingredientRequirements,
                                  {
                                    item: "New ingredient",
                                    category: "Other",
                                    quantity: null,
                                    unit: null,
                                    optional: false,
                                    inventoryEntryId: null,
                                  },
                                ],
                              })
                            }
                          >
                            Add ingredient
                          </button>
                        </header>
                        {meal.ingredientRequirements.map((requirement, requirementIndex) => (
                          <div
                            className="meal-requirement-row"
                            key={`${meal.id}-requirement-${requirementIndex}`}
                          >
                            <input
                              aria-label="Ingredient"
                              value={requirement.item}
                              onChange={(event) =>
                                updateRequirement(index, requirementIndex, {
                                  item: event.target.value,
                                })
                              }
                            />
                            <input
                              aria-label="Ingredient category"
                              value={requirement.category}
                              onChange={(event) =>
                                updateRequirement(index, requirementIndex, {
                                  category: event.target.value,
                                })
                              }
                            />
                            <input
                              aria-label="Ingredient quantity"
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={requirement.quantity ?? ""}
                              onChange={(event) =>
                                updateRequirement(index, requirementIndex, {
                                  quantity:
                                    event.target.value === "" ? null : Number(event.target.value),
                                })
                              }
                            />
                            <input
                              aria-label="Ingredient unit"
                              value={requirement.unit ?? ""}
                              onChange={(event) =>
                                updateRequirement(index, requirementIndex, {
                                  unit: event.target.value || null,
                                })
                              }
                            />
                            <label className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={requirement.optional}
                                onChange={(event) =>
                                  updateRequirement(index, requirementIndex, {
                                    optional: event.target.checked,
                                  })
                                }
                              />
                              Optional
                            </label>
                            <button
                              type="button"
                              className="danger-link"
                              onClick={() =>
                                updateMeal(index, {
                                  ingredientRequirements: meal.ingredientRequirements.filter(
                                    (_, innerIndex) => innerIndex !== requirementIndex,
                                  ),
                                })
                              }
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="danger-link"
                        onClick={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  meals: current.meals.filter(
                                    (_, mealIndex) => mealIndex !== index,
                                  ),
                                }
                              : current,
                          )
                        }
                      >
                        Remove meal
                      </button>
                    </div>
                  ))}

                  <div className="editor-toolbar">
                    <strong>No-meal exceptions</strong>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!users.length}
                      onClick={() =>
                        setDraft((current) =>
                          current && users[0]
                            ? {
                                ...current,
                                coverageExceptions: [
                                  ...current.coverageExceptions,
                                  blankException(plan, users[0].id),
                                ],
                              }
                            : current,
                        )
                      }
                    >
                      Add exception
                    </button>
                  </div>
                  {payload.coverageExceptions.map((entry, index) => (
                    <div className="plan-exception-edit" key={entry.id}>
                      <label>
                        Date
                        <input
                          type="date"
                          min={plan.startDate}
                          max={plan.endDate}
                          value={entry.mealDate}
                          onChange={(event) =>
                            updateException(index, { mealDate: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Meal
                        <select
                          value={entry.mealType}
                          onChange={(event) =>
                            updateException(index, {
                              mealType: event.target.value as CoverageException["mealType"],
                            })
                          }
                        >
                          <option value="breakfast">Breakfast</option>
                          <option value="lunch">Lunch</option>
                          <option value="dinner">Dinner</option>
                        </select>
                      </label>
                      <label>
                        Person
                        <select
                          value={entry.userId}
                          onChange={(event) =>
                            updateException(index, { userId: event.target.value })
                          }
                        >
                          {users.map((user) => (
                            <option value={user.id} key={user.id}>
                              {user.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Reason
                        <input
                          value={entry.reason}
                          onChange={(event) =>
                            updateException(index, { reason: event.target.value })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="danger-link"
                        onClick={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  coverageExceptions: current.coverageExceptions.filter(
                                    (_, entryIndex) => entryIndex !== index,
                                  ),
                                }
                              : current,
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  <div className="editor-toolbar">
                    <strong>Proposed shopping</strong>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        setDraft((current) =>
                          current
                            ? { ...current, shopping: [...current.shopping, blankShopping()] }
                            : current,
                        )
                      }
                    >
                      Add item
                    </button>
                  </div>
                  {payload.shopping.map((item, index) => (
                    <div className="plan-shopping-edit" key={item.id}>
                      <input
                        aria-label="Shopping item"
                        value={item.item}
                        onChange={(event) => updateShopping(index, { item: event.target.value })}
                      />
                      <input
                        aria-label="Category"
                        value={item.category}
                        onChange={(event) =>
                          updateShopping(index, { category: event.target.value })
                        }
                      />
                      <input
                        aria-label="Quantity"
                        type="number"
                        min="0"
                        step="0.001"
                        value={item.quantity ?? ""}
                        onChange={(event) =>
                          updateShopping(index, {
                            quantity: event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                      />
                      <input
                        aria-label="Unit"
                        value={item.unit ?? ""}
                        onChange={(event) =>
                          updateShopping(index, { unit: event.target.value || null })
                        }
                      />
                      <input
                        aria-label="Reason"
                        value={item.reason}
                        onChange={(event) => updateShopping(index, { reason: event.target.value })}
                      />
                      <button
                        type="button"
                        className="danger-link"
                        onClick={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  shopping: current.shopping.filter(
                                    (_, itemIndex) => itemIndex !== index,
                                  ),
                                }
                              : current,
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="form-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setEditId(null);
                        setDraft(null);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy}
                      onClick={() => save(plan.id)}
                    >
                      Save and validate revision
                    </button>
                  </div>
                </div>
              ) : (
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
              )}

              {!editing && payload.prepTasks.length > 0 && (
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
              {!editing && (
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
                </div>
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
                        onClick={() => restore(plan.id)}
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
                        onClick={() => archivePlan(plan.id)}
                      >
                        Archive proposal
                      </button>
                      <button
                        type="button"
                        className="danger-link"
                        disabled={busy}
                        onClick={() => decide(plan.id, "reject")}
                      >
                        Reject plan
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => beginEdit(plan)}
                      >
                        Edit plan
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={busy || errors.length > 0}
                        onClick={() => decide(plan.id, "commit")}
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
                      onClick={() => archivePlan(plan.id)}
                    >
                      Archive proposal
                    </button>
                  </div>
                )}
              </footer>
            </article>
          );
        })}
        {plans.length === 0 && <p className="empty-state">No generated weekly plans yet.</p>}
      </div>
    </section>
  );
}
