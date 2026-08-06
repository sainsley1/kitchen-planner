"use client";

import type { FormEvent } from "react";

interface WeeklyPlanFormProps {
  startDate: string;
  setStartDate: (val: string) => void;
  endDate: string;
  setEndDate: (val: string) => void;
  startMeal: string;
  setStartMeal: (val: string) => void;
  endMeal: string;
  setEndMeal: (val: string) => void;
  planningMode: "balanced" | "deep";
  setPlanningMode: (val: "balanced" | "deep") => void;
  notes: string;
  setNotes: (val: string) => void;
  includeSnacks: boolean;
  setIncludeSnacks: (val: boolean) => void;
  includeDesserts: boolean;
  setIncludeDesserts: (val: boolean) => void;
  discoverRecipes: boolean;
  setDiscoverRecipes: (val: boolean) => void;
  aiConfigured: boolean;
  busy: boolean;
  hasActiveJob: boolean;
  balancedModel: string;
  deepModel: string;
  deepEffort: string;
  error: string;
  message: string;
  onSubmit: (event: FormEvent) => void;
}

export function WeeklyPlanForm({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  startMeal,
  setStartMeal,
  endMeal,
  setEndMeal,
  planningMode,
  setPlanningMode,
  notes,
  setNotes,
  includeSnacks,
  setIncludeSnacks,
  includeDesserts,
  setIncludeDesserts,
  discoverRecipes,
  setDiscoverRecipes,
  aiConfigured,
  busy,
  hasActiveJob,
  balancedModel,
  deepModel,
  deepEffort,
  error,
  message,
  onSubmit,
}: WeeklyPlanFormProps) {
  return (
    <>
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

      <form className="weekly-plan-request" onSubmit={onSubmit}>
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
    </>
  );
}
