export const MAX_WEEKLY_PLAN_WARNINGS = 30;
export const WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX = "Additional planner warnings omitted:";

/**
 * Persisted weekly plans intentionally keep a compact warning list. Model and
 * deterministic reconciliation warnings can both grow with a detailed plan,
 * so normalize them before the persisted schema is applied.
 */
export function boundWeeklyPlanWarnings(values: string[], limit = MAX_WEEKLY_PLAN_WARNINGS) {
  const uniqueInput = [...new Set(values.map((warning) => warning.trim()).filter(Boolean))];
  let previouslyOmitted = 0;
  const unique = uniqueInput.filter((warning) => {
    if (!warning.startsWith(WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX)) return true;
    const count = Number(
      warning.slice(WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX.length).trim().match(/^\d+/)?.[0] ?? 1,
    );
    previouslyOmitted += Number.isFinite(count) && count > 0 ? count : 1;
    return false;
  });
  if (unique.length + previouslyOmitted <= limit) {
    return previouslyOmitted
      ? [
          ...unique,
          `${WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX} ${previouslyOmitted} additional distinct warning${previouslyOmitted === 1 ? " was" : "s were"} condensed to keep this plan reviewable.`,
        ]
      : unique;
  }
  if (limit <= 0) return [];
  const retained = unique.slice(0, Math.max(0, limit - 1));
  const omitted = previouslyOmitted + unique.length - retained.length;
  return [
    ...retained,
    `${WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX} ${omitted} additional distinct warning${omitted === 1 ? " was" : "s were"} condensed to keep this plan reviewable.`,
  ];
}
