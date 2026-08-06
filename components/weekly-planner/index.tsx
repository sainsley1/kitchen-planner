"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { WeeklyPlan } from "@/lib/ai/contracts";
import type { WeeklyPlanJobRecord, WeeklyPlanRecord } from "@/lib/db/queries";
import { householdDateKey } from "@/lib/datetime";
import type {
  CoverageException,
  IngredientRequirement,
  InventorySearchState,
  Meal,
  ShoppingDecision,
  ShoppingLine,
  WeeklyPlannerProps,
} from "./types";

import { WeeklyPlanCard } from "./weekly-plan-card";
import { WeeklyPlanForm } from "./weekly-plan-form";
import { WeeklyPlanJobTracker } from "./weekly-plan-job-tracker";

function defaultWindow(timeZone: string) {
  const today = householdDateKey(new Date(), timeZone);
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + ((6 - date.getUTCDay() + 7) % 7));
  const start = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 7);
  return { start, end: date.toISOString().slice(0, 10) };
}

export function WeeklyPlanner({
  plans,
  planningJobs,
  users,
  recipes,
  unscheduled,
  inventory,
  timeZone,
  aiConfigured,
  balancedModel,
  deepModel,
  deepEffort,
  routineModel,
  fallbackModel,
}: WeeklyPlannerProps) {
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
  const [inventorySearch, setInventorySearch] = useState<InventorySearchState | null>(null);
  const [replaceExisting, setReplaceExisting] = useState<Record<string, boolean>>({});
  const [restoreRevision, setRestoreRevision] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState(planningJobs);
  const [clock, setClock] = useState(Date.now());

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
  function cancelEdit() {
    setEditId(null);
    setDraft(null);
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
  function setShoppingDecision(
    line: ShoppingLine,
    action: ShoppingDecision["action"],
    inventoryEntryId: string | null,
  ) {
    const requirementKey = line.requirementKey;
    if (!requirementKey) return;
    setDraft((current) =>
      current
        ? {
            ...current,
            shoppingDecisions: [
              ...current.shoppingDecisions.filter(
                (decision) => decision.requirementKey !== requirementKey,
              ),
              {
                requirementKey,
                item: line.item,
                unit: line.unit,
                mealIds: [...line.mealIds],
                action,
                inventoryEntryId,
              },
            ],
          }
        : current,
    );
    setInventorySearch(null);
  }
  function undoShoppingDecision(requirementKey: string) {
    setDraft((current) =>
      current
        ? {
            ...current,
            shoppingDecisions: current.shoppingDecisions.filter(
              (decision) => decision.requirementKey !== requirementKey,
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
      <WeeklyPlanForm
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        startMeal={startMeal}
        setStartMeal={setStartMeal}
        endMeal={endMeal}
        setEndMeal={setEndMeal}
        planningMode={planningMode}
        setPlanningMode={setPlanningMode}
        notes={notes}
        setNotes={setNotes}
        includeSnacks={includeSnacks}
        setIncludeSnacks={setIncludeSnacks}
        includeDesserts={includeDesserts}
        setIncludeDesserts={setIncludeDesserts}
        discoverRecipes={discoverRecipes}
        setDiscoverRecipes={setDiscoverRecipes}
        aiConfigured={aiConfigured}
        busy={busy}
        hasActiveJob={hasActiveJob}
        balancedModel={balancedModel}
        deepModel={deepModel}
        deepEffort={deepEffort}
        error={error}
        message={message}
        onSubmit={generate}
      />

      <WeeklyPlanJobTracker
        jobs={jobs}
        clock={clock}
        balancedModel={balancedModel}
        deepModel={deepModel}
        busy={busy}
        hasActiveJob={hasActiveJob}
        onJobAction={jobAction}
      />

      <div className="weekly-plan-list">
        {plans.map((plan) => (
          <WeeklyPlanCard
            key={plan.id}
            plan={plan}
            editId={editId}
            draft={draft}
            users={users}
            recipes={recipes}
            unscheduled={unscheduled}
            inventory={inventory}
            timeZone={timeZone}
            busy={busy}
            deepModel={deepModel}
            balancedModel={balancedModel}
            routineModel={routineModel}
            fallbackModel={fallbackModel}
            inventorySearch={inventorySearch}
            replaceExisting={replaceExisting}
            restoreRevision={restoreRevision}
            setInventorySearch={setInventorySearch}
            setReplaceExisting={setReplaceExisting}
            setRestoreRevision={setRestoreRevision}
            setDraft={setDraft}
            onBeginEdit={beginEdit}
            onCancelEdit={cancelEdit}
            onSave={save}
            onDecide={decide}
            onArchive={archivePlan}
            onRestore={restore}
            updateMeal={updateMeal}
            updateRequirement={updateRequirement}
            updateException={updateException}
            updateShopping={updateShopping}
            setShoppingDecision={setShoppingDecision}
            undoShoppingDecision={undoShoppingDecision}
          />
        ))}
        {plans.length === 0 && <p className="empty-state">No generated weekly plans yet.</p>}
      </div>
    </section>
  );
}
