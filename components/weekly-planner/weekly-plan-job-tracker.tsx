"use client";

import type { WeeklyPlanJobRecord } from "@/lib/db/queries";

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

interface WeeklyPlanJobTrackerProps {
  jobs: WeeklyPlanJobRecord[];
  clock: number;
  balancedModel: string;
  deepModel: string;
  busy: boolean;
  hasActiveJob: boolean;
  onJobAction: (job: WeeklyPlanJobRecord, action: "cancel" | "retry" | "dismiss") => void;
}

export function WeeklyPlanJobTracker({
  jobs,
  clock,
  balancedModel,
  deepModel,
  busy,
  hasActiveJob,
  onJobAction,
}: WeeklyPlanJobTrackerProps) {
  if (jobs.length === 0) return null;

  return (
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
                {job.planningMode === "deep" ? "Deep" : "Balanced"} · {job.model ?? defaultModel} ·{" "}
                {search}
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
                onClick={() => onJobAction(job, "cancel")}
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
                  onClick={() => onJobAction(job, "retry")}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="danger-link"
                  disabled={busy}
                  onClick={() => onJobAction(job, "dismiss")}
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
  );
}
