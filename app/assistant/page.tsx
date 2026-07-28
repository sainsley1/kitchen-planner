import type { Metadata } from "next";
import { AiProposalList } from "@/components/ai-proposal-list";
import { QuickUpdate } from "@/components/quick-update";
import { requirePageSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { listAiProposals } from "@/lib/db/queries";

export const metadata: Metadata = { title: "AI assistant" };
export default async function AssistantPage() {
  const session = await requirePageSession();
  const proposals = await listAiProposals(session.householdId);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Proposal-only intelligence</span>
          <h1>Kitchen assistant</h1>
          <p>
            Describe changes naturally, inspect the proposed actions, and approve only what belongs
            in the household record.
          </p>
        </div>
        <span className={`status-chip ${appConfig.aiConfigured ? "ready" : "warning"}`}>
          {appConfig.aiConfigured ? "OpenAI connected" : "Setup required"}
        </span>
      </div>
      <section className="section-card">
        <header>
          <h2>Quick household update</h2>
        </header>
        <QuickUpdate aiConfigured={appConfig.aiConfigured} />
      </section>
      <section className="section-card">
        <header>
          <div>
            <h2>Proposal history</h2>
            <p className="muted">
              Pending proposals remain recoverable for seven days. Approved proposals show exactly
              which actions were applied.
            </p>
          </div>
        </header>
        <AiProposalList proposals={proposals} />
      </section>
    </div>
  );
}
