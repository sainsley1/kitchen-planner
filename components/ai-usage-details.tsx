import type { AiUsageSummary } from "@/lib/db/queries";
import { formatHouseholdDateTime } from "@/lib/datetime";

function tierLabel(tier: string) {
  if (tier === "economy") return "Economy";
  if (tier === "primary") return "Primary";
  if (tier === "balanced") return "Balanced planning";
  if (tier === "planning") return "Deep planning";
  if (tier === "fallback") return "Advanced / fallback";
  return tier.replaceAll("_", " ");
}
function workflowLabel(workflow: string) {
  return workflow.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function cost(value: string | null) {
  if (value == null) return "Not recorded";
  const amount = Number(value);
  return `$${amount < 0.01 ? amount.toFixed(6) : amount.toFixed(4)}`;
}
function duration(milliseconds: number | null) {
  if (milliseconds == null) return "Not recorded";
  return milliseconds >= 60_000
    ? `${(milliseconds / 60_000).toFixed(1)} min`
    : `${(milliseconds / 1000).toFixed(1)} sec`;
}

export function AiUsageDetails({ usage, timeZone }: { usage: AiUsageSummary; timeZone: string }) {
  return (
    <div>
      <div className="ai-usage-grid">
        <div>
          <span>Runs</span>
          <strong>{usage.runs}</strong>
          <small>{usage.failedRuns} failed</small>
        </div>
        <div>
          <span>Tokens</span>
          <strong>{usage.totalTokens.toLocaleString()}</strong>
          <small>
            {usage.inputTokens.toLocaleString()} in · {usage.outputTokens.toLocaleString()} out
          </small>
        </div>
        <div>
          <span>Retail estimate</span>
          <strong>${Number(usage.estimatedCostUsd).toFixed(4)}</strong>
          <small>USD before grants or credits</small>
        </div>
      </div>
      <div className="ai-tier-usage">
        {usage.tiers.map((tier) => (
          <div key={`${tier.modelTier}-${tier.model}`}>
            <span>
              <strong>{tierLabel(tier.modelTier)}</strong>
              <small>{tier.model}</small>
            </span>
            <span>
              {tier.runs} run{tier.runs === 1 ? "" : "s"}
            </span>
            <span>{tier.totalTokens.toLocaleString()} tokens</span>
            <span>${Number(tier.estimatedCostUsd).toFixed(4)}</span>
          </div>
        ))}
        {!usage.tiers.length && <p className="muted">No AI runs in the last 30 days.</p>}
      </div>
      <details className="ai-run-history">
        <summary>Recent run details · latest {usage.recentRuns.length}</summary>
        <div className="ai-run-history-list">
          {usage.recentRuns.map((run) => (
            <details className="ai-run-history-item" key={run.id}>
              <summary>
                <span>
                  <strong>{workflowLabel(run.workflow)}</strong>
                  <small>
                    {formatHouseholdDateTime(run.createdAt, timeZone)} · {tierLabel(run.modelTier)}{" "}
                    · {run.model}
                  </small>
                </span>
                <span>
                  <strong>{cost(run.estimatedCostUsd)}</strong>
                  <small>
                    {run.totalTokens?.toLocaleString() ?? "—"} tokens · {run.status}
                  </small>
                </span>
              </summary>
              <dl>
                <div>
                  <dt>Reasoning</dt>
                  <dd>{run.reasoningEffort}</dd>
                </div>
                <div>
                  <dt>Input</dt>
                  <dd>{run.inputTokens?.toLocaleString() ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Cached input</dt>
                  <dd>{run.cachedInputTokens?.toLocaleString() ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>{run.outputTokens?.toLocaleString() ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{duration(run.latencyMs)}</dd>
                </div>
                <div>
                  <dt>Web searches</dt>
                  <dd>{run.webSearchCalls}</dd>
                </div>
              </dl>
              {run.errorMessage && <p className="form-error">{run.errorMessage}</p>}
            </details>
          ))}
          {!usage.recentRuns.length && (
            <p className="muted">No individual runs have been recorded.</p>
          )}
        </div>
      </details>
    </div>
  );
}
