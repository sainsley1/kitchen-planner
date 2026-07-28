import type { Metadata } from "next";
import { AuditHistory } from "@/components/audit-history";
import { ImportBatchList } from "@/components/import-batch-list";
import { ImportPreview } from "@/components/import-preview";
import { TimezoneSettings } from "@/components/timezone-settings";
import { RecipeSourceSettings } from "@/components/recipe-source-settings";
import { AiUsageDetails } from "@/components/ai-usage-details";
import { requirePageSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import {
  getAiUsageSummary,
  getHouseholdTimezone,
  listAuditEvents,
  listImportBatches,
} from "@/lib/db/queries";
import { getRecipeSourcePreferences } from "@/lib/services/recipe-source-settings";

export const metadata: Metadata = { title: "Settings" };

function availableTimeZones(current: string) {
  const supported =
    (
      Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] }
    ).supportedValuesOf?.("timeZone") ?? [];
  return [
    ...new Set([
      current,
      "America/Vancouver",
      "America/Edmonton",
      "America/Toronto",
      "America/Halifax",
      "America/St_Johns",
      ...supported,
    ]),
  ].sort();
}

export default async function SettingsPage() {
  const session = await requirePageSession();
  const [auditPage, batches, timeZone, aiUsage, recipeSources] = await Promise.all([
    listAuditEvents(session.householdId, 11),
    listImportBatches(session.householdId),
    getHouseholdTimezone(session.householdId),
    getAiUsageSummary(session.householdId),
    getRecipeSourcePreferences(session.householdId),
  ]);
  const audit = auditPage.slice(0, 10);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Household controls</span>
          <h1>Settings</h1>
          <p>
            Manage household time, workbook imports and the detailed application change history.
          </p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="section-card wide-card">
          <header>
            <h2>Application</h2>
          </header>
          <div className="settings-application">
            <dl className="settings-list">
              <div>
                <dt>Version</dt>
                <dd>{appConfig.version}</dd>
              </div>
              <div>
                <dt>Data mode</dt>
                <dd>
                  <span className={`status-chip ${appConfig.demoMode ? "warning" : "ready"}`}>
                    {appConfig.demoMode ? "Staging" : "Canonical database"}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Signed in</dt>
                <dd>
                  {session.displayName} · {session.role}
                </dd>
              </div>
              <div>
                <dt>Database</dt>
                <dd>{appConfig.databaseUrl ? "Connected" : "Not configured"}</dd>
              </div>
            </dl>
            <TimezoneSettings
              currentTimeZone={timeZone}
              timeZones={availableTimeZones(timeZone)}
              canManage={session.role === "owner"}
            />
          </div>
        </section>
        <section className="section-card wide-card ai-settings">
          <header>
            <div>
              <h2>AI workflows</h2>
              <p className="muted">
                Routine work stays on GPT-5.4 mini or GPT-5.4. Full-week planning defaults to
                balanced Terra at medium reasoning, with deep Sol available only when explicitly
                selected.
              </p>
            </div>
            <span className={`status-chip ${appConfig.aiConfigured ? "ready" : "warning"}`}>
              {appConfig.aiConfigured ? "Connected" : "Setup required"}
            </span>
          </header>
          <div className="ai-settings-grid">
            <div>
              <dl className="settings-list">
                <div>
                  <dt>Economy · low effort</dt>
                  <dd>{appConfig.models.economy}</dd>
                </div>
                <div>
                  <dt>Primary · low effort</dt>
                  <dd>{appConfig.models.routine}</dd>
                </div>
                <div>
                  <dt>Balanced weekly plan · medium</dt>
                  <dd>{appConfig.models.fallback}</dd>
                </div>
                <div>
                  <dt>Deep weekly plan · {appConfig.planningReasoningEffort}</dt>
                  <dd>{appConfig.models.planning}</dd>
                </div>
                <div>
                  <dt>Future reconciliation</dt>
                  <dd>{appConfig.models.reconciliation}</dd>
                </div>
                <div>
                  <dt>Escalation policy</dt>
                  <dd>Balanced plans never escalate to Sol automatically</dd>
                </div>
                <div>
                  <dt>Mutation policy</dt>
                  <dd>Preview and approve</dd>
                </div>
              </dl>
              {!appConfig.aiConfigured && (
                <div className="ai-setup-note">
                  <strong>Enable AI without exposing the key to the browser</strong>
                  <p>
                    Add <code>OPENAI_API_KEY=…</code> to the app&apos;s <code>.env</code>, then run{" "}
                    <code>./unraid.sh update</code>. Do not paste the key into Kitchen Planner.
                  </p>
                </div>
              )}
            </div>
            <AiUsageDetails usage={aiUsage} timeZone={timeZone} />
          </div>
        </section>
        <section className="section-card wide-card">
          <header>
            <div>
              <h2>Recipe discovery</h2>
              <p className="muted">
                Control which publishers live planning and draft refinements should prefer or avoid.
              </p>
            </div>
          </header>
          <RecipeSourceSettings initial={recipeSources} canManage={session.role === "owner"} />
        </section>
        <section className="section-card wide-card">
          <header>
            <h2>Workbook imports</h2>
          </header>
          {session.role === "owner" ? (
            <ImportPreview />
          ) : (
            <p className="muted">Only the household owner can stage or reconcile a workbook.</p>
          )}
          <ImportBatchList
            batches={batches}
            timeZone={timeZone}
            canManage={session.role === "owner"}
          />
        </section>
        <section className="section-card wide-card">
          <header>
            <div>
              <h2>Audit history</h2>
              <p className="muted">
                Showing the 10 most recent changes. Select an entry to inspect its field-level
                details.
              </p>
            </div>
          </header>
          <AuditHistory
            initialItems={audit}
            initialHasMore={auditPage.length > 10}
            timeZone={timeZone}
          />
        </section>
      </div>
    </div>
  );
}
