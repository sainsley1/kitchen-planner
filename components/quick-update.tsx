"use client";

import { FormEvent, useState } from "react";
import { AiProposalCard } from "@/components/ai-proposal-card";
import { AiFallbackOffer, type FallbackOffer } from "@/components/ai-fallback-offer";

type GeneratedProposal = {
  id: string;
  workflow: string;
  status: string;
  payload: {
    title: string;
    summary: string;
    warnings: string[];
    actions: Array<{
      id: string;
      type: string;
      label: string;
      explanation: string;
      [key: string]: unknown;
    }>;
  };
};

export function QuickUpdate({ aiConfigured }: { aiConfigured: boolean }) {
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<GeneratedProposal | null>(null);
  const [fallback, setFallback] = useState<FallbackOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function request(body: unknown) {
    setBusy(true);
    setError("");
    const response = await fetch("/api/v1/ai/quick-update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setError(payload.error || "Could not prepare this update.");
    setProposal(payload.proposal ?? null);
    setFallback(payload.fallback ?? null);
  }
  async function preview(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || !aiConfigured) return;
    setProposal(null);
    setFallback(null);
    await request({ text });
  }
  return (
    <div className="ai-workflow">
      <form className="quick-update" onSubmit={preview}>
        <label htmlFor="quick-update">What changed in the kitchen?</label>
        <div className="quick-row">
          <input
            id="quick-update"
            maxLength={4000}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setProposal(null);
              setFallback(null);
              setError("");
            }}
            placeholder="Example: A household member drank one soda and I froze a portion of pasta"
          />
          <button disabled={!aiConfigured || busy || text.trim().length < 2} type="submit">
            {busy ? "Preparing…" : "Preview update"}
          </button>
        </div>
        {!aiConfigured && (
          <div className="safe-preview">
            <strong>OpenAI setup required.</strong>
            <span>Add the API key in Settings to enable proposal generation.</span>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
      </form>
      {fallback && (
        <AiFallbackOffer
          offer={fallback}
          busy={busy}
          onRetry={() => request({ fallbackOfJobId: fallback.sourceJobId })}
        />
      )}{" "}
      {proposal && (
        <AiProposalCard
          proposal={proposal}
          onDecision={() => {
            setProposal(null);
            setFallback(null);
            setText("");
          }}
        />
      )}
    </div>
  );
}
