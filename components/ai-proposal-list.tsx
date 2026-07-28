"use client";

import type { AiProposalRecord } from "@/lib/db/queries";
import { AiProposalCard } from "@/components/ai-proposal-card";

export function AiProposalList({ proposals }: { proposals: AiProposalRecord[] }) {
  return (
    <div className="ai-proposal-list">
      {proposals.map((proposal) => (
        <AiProposalCard key={proposal.id} proposal={proposal} />
      ))}
      {!proposals.length && <p className="empty-state">No AI proposals have been generated yet.</p>}
    </div>
  );
}
