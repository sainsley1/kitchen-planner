"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AiProposalRecord } from "@/lib/db/queries";
import { formatQuantity } from "@/lib/format";

type Proposal = Pick<AiProposalRecord, "id" | "status" | "workflow" | "payload"> &
  Partial<AiProposalRecord>;

function actionDetail(action: Record<string, unknown>) {
  if (action.type === "inventory_quantity")
    return `${String(action.quantityMode)} ${formatQuantity(action.quantity as string | number | null)}${action.unit ? ` ${action.unit}` : ""}`;
  if (action.type === "inventory_move")
    return action.storageDetail ? String(action.storageDetail) : "Change storage location";
  if (action.type === "inventory_create")
    return `${formatQuantity(action.quantity as string | number | null)} ${String(action.unit ?? "")} · ${String(action.category ?? "")}`;
  if (action.type === "inventory_archive")
    return action.addToShopping
      ? "Remove from inventory and add to shopping"
      : "Remove from inventory";
  if (action.type === "shopping_add")
    return `${formatQuantity(action.quantity as string | number | null)} ${String(action.unit ?? "")}`;
  if (action.type === "shopping_status")
    return `Set shopping status to ${String(action.shoppingStatus).replaceAll("_", " ")}`;
  if (action.type === "feedback_create")
    return `${String(action.rating ?? "")} · ${String(action.dish ?? "")}`;
  if (action.type === "preference_create")
    return String(action.classification ?? "").replaceAll("_", " ");
  return String(action.type).replaceAll("_", " ");
}

export function AiProposalCard({
  proposal,
  onDecision,
}: {
  proposal: Proposal;
  onDecision?: () => void;
}) {
  const router = useRouter();
  const actions = proposal.payload.actions ?? [];
  const pending = proposal.status === "pending";
  const [selected, setSelected] = useState<string[]>(
    pending ? actions.map((action) => action.id) : (proposal.selectedActionIds ?? []),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(proposal.status);
  async function decide(kind: "commit" | "reject") {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/v1/ai/proposals/${proposal.id}/${kind}`, {
      method: "POST",
      headers: kind === "commit" ? { "content-type": "application/json" } : undefined,
      body: kind === "commit" ? JSON.stringify({ actionIds: selected }) : undefined,
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setError(body.error || "Could not decide this proposal.");
    setStatus(kind === "commit" ? "approved" : "rejected");
    onDecision?.();
    router.refresh();
  }
  return (
    <article className={`ai-proposal ${status}`}>
      <header>
        <div>
          <span className="eyebrow">{proposal.workflow.replaceAll("_", " ")}</span>
          <h3>{proposal.payload.title}</h3>
          <p>{proposal.payload.summary}</p>
        </div>
        <span className={`status-chip ${status === "pending" ? "warning" : "ready"}`}>
          {status}
        </span>
      </header>
      {proposal.payload.warnings?.length > 0 && (
        <ul className="issue-list">
          {proposal.payload.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}
      <div className="ai-action-list">
        {actions.map((action) => (
          <label className={selected.includes(action.id) ? "selected" : ""} key={action.id}>
            {pending && (
              <input
                type="checkbox"
                checked={selected.includes(action.id)}
                onChange={() =>
                  setSelected((current) =>
                    current.includes(action.id)
                      ? current.filter((id) => id !== action.id)
                      : [...current, action.id],
                  )
                }
              />
            )}
            <span>
              <strong>{action.label}</strong>
              <small>
                {actionDetail(action)} · {action.explanation}
              </small>
            </span>
          </label>
        ))}
      </div>
      {(proposal.model || proposal.totalTokens != null || proposal.estimatedCostUsd) && (
        <footer className="ai-run-meta">
          <span>
            {proposal.modelTier === "fallback"
              ? "Advanced fallback"
              : proposal.modelTier === "economy"
                ? "Economy"
                : "Primary"}{" "}
            · {proposal.model ?? "Configured model"}
          </span>
          {proposal.totalTokens != null && (
            <span>{proposal.totalTokens.toLocaleString()} tokens</span>
          )}
          {proposal.estimatedCostUsd && (
            <span>Retail estimate ${Number(proposal.estimatedCostUsd).toFixed(4)} USD</span>
          )}
        </footer>
      )}
      {error && <p className="form-error">{error}</p>}
      {pending && status === "pending" && (
        <div className="form-actions">
          <button className="secondary-button" disabled={busy} onClick={() => decide("reject")}>
            Reject proposal
          </button>
          <button
            className="primary-button"
            disabled={busy || selected.length === 0}
            onClick={() => decide("commit")}
          >
            {busy ? "Applying…" : `Apply ${selected.length} selected`}
          </button>
        </div>
      )}
    </article>
  );
}
