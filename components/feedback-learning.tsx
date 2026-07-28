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

export function FeedbackLearning({ aiConfigured }: { aiConfigured: boolean }) {
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<GeneratedProposal | null>(null);
  const [fallback, setFallback] = useState<FallbackOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function request(body: unknown) {
    setBusy(true);
    setError("");
    const response = await fetch("/api/v1/ai/feedback-learning", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setError(payload.error || "Could not interpret this feedback.");
    setProposal(payload.proposal ?? null);
    setFallback(payload.fallback ?? null);
  }
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || !aiConfigured) return;
    setProposal(null);
    setFallback(null);
    await request({ text });
  }
  return (
    <section className="section-card ai-feedback">
      <header>
        <div>
          <span className="eyebrow">Feedback learner</span>
          <h2>Describe what everyone thought</h2>
          <p className="muted">
            GPT-5.4 separates dish feedback from possible long-term learning. You choose exactly
            what is saved.
          </p>
        </div>
      </header>
      <form className="entity-form" onSubmit={generate}>
        <label className="ai-textarea-label">
          Feedback
          <textarea
            disabled={!aiConfigured || busy}
            maxLength={4000}
            required
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setProposal(null);
              setFallback(null);
              setError("");
            }}
            placeholder="Example: One person loved the soup. Another liked the flavour of the stew, but the sauce split."
          />
        </label>
        {!aiConfigured && (
          <p className="safe-preview">
            <strong>OpenAI setup required.</strong>
            <span>Add the API key in Settings first.</span>
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button
            className="primary-button"
            disabled={!aiConfigured || busy || text.trim().length < 2}
          >
            {busy ? "Learning…" : "Prepare with GPT-5.4"}
          </button>
        </div>
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
    </section>
  );
}
