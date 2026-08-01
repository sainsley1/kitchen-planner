"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportReconciliationRow } from "@/lib/db/queries";
import { formatHouseholdDateTime } from "@/lib/datetime";
import {
  FEEDBACK_RATINGS,
  INVENTORY_PRIORITIES,
  MEAL_STATUSES,
  MEAL_TYPES,
  PACKAGE_STATES,
  PREFERENCE_STATUSES,
  SHOPPING_STATUSES,
  optionLabel,
} from "@/lib/options";

type Batch = {
  id: string;
  sourceFilename: string;
  status: string;
  sourceRows: number;
  acceptedRows: number;
  warningRows: number;
  rejectedRows: number;
  reconciliationRows: number;
  resolvedRows: number;
  committedAt: string | null;
};
const labels: Record<string, string> = {
  ingredient: "Ingredient",
  brandVariety: "Brand / variety",
  category: "Category",
  quantity: "Quantity",
  unit: "Unit",
  locationName: "Location",
  storageDetail: "Storage detail",
  packageState: "Package state",
  bestBefore: "Best before",
  priority: "Priority",
  notes: "Notes",
  verifiedAt: "Last verified",
  person: "Person",
  topic: "Food / dish / rule",
  classification: "Classification",
  detail: "Details",
  context: "Context",
  status: "Status",
  effectiveDate: "Effective date",
  feedbackDate: "Feedback date",
  dish: "Dish",
  mealType: "Meal type",
  recipeUrl: "Recipe URL",
  recipeNote: "Recipe note",
  rating: "Rating",
  feedback: "Feedback",
  nextTimeChanges: "Next-time changes",
  repeatDecision: "Repeat decision",
  targetMinimum: "Target minimum",
  preferredBrand: "Preferred brand",
  currentStatus: "Current status",
  reorderRule: "Reorder rule",
  reviewedAt: "Last reviewed",
  item: "Item",
  dateAdded: "Date added",
  mealDate: "Meal date",
  assignedPerson: "Person",
  plannedYield: "Planned yield",
  packedLunch: "Packed lunch",
  leftoverPrepLink: "Leftover / prep link",
  weekStart: "Week starts",
  itemType: "Type",
  title: "Title",
  prepLink: "Prep link",
};
const actionLabels: Record<string, string> = {
  import: "Import as a new record",
  import_unscheduled: "Import into Unscheduled items",
  skip: "Skip this workbook row",
  use_existing: "Use the existing record; do not import a duplicate",
  replace_existing: "Replace the selected existing record with this workbook row",
};
const dateFields = new Set([
  "bestBefore",
  "verifiedAt",
  "effectiveDate",
  "feedbackDate",
  "reviewedAt",
  "dateAdded",
  "mealDate",
  "weekStart",
]);
const numberFields = new Set(["quantity", "targetMinimum"]);

function constrainedOptions(destination: string | null, key: string): readonly string[] | null {
  if (key === "packageState") return PACKAGE_STATES;
  if (key === "mealType" || key === "itemType") return MEAL_TYPES;
  if (key === "rating") return FEEDBACK_RATINGS;
  if (key === "priority") return INVENTORY_PRIORITIES;
  if (key === "status") {
    if (destination === "shopping_item") return SHOPPING_STATUSES;
    if (destination === "food_preference") return PREFERENCE_STATUSES;
    return MEAL_STATUSES;
  }
  return null;
}

function RowEditor({
  row,
  onSaved,
  readOnly = false,
}: {
  row: ImportReconciliationRow;
  onSaved: (resolvedRows: number) => void;
  readOnly?: boolean;
}) {
  const initialPayload = row.resolutionPayload ?? row.normalizedPayload ?? {};
  const [payload, setPayload] = useState<Record<string, unknown>>(initialPayload);
  const databaseCandidates = row.duplicateCandidates.filter(
    (candidate) => candidate.id && !candidate.synthetic,
  );
  const suggestedTarget = databaseCandidates[0]?.id ?? "";
  const [action, setAction] = useState(row.resolutionAction ?? row.suggestedAction ?? "skip");
  const [targetId, setTargetId] = useState(row.resolutionTargetId ?? suggestedTarget ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(row.resolvedAt ? "Decision saved" : "");
  const imports =
    action === "import" || action === "import_unscheduled" || action === "replace_existing";
  const actions = row.destinationType
    ? [
        ...(row.destinationType === "unscheduled_item" ? ["import_unscheduled"] : ["import"]),
        "skip",
        ...(databaseCandidates.length ? ["use_existing", "replace_existing"] : []),
      ]
    : ["skip"];
  function update(key: string, value: unknown) {
    setPayload((current) => ({ ...current, [key]: value }));
    setMessage("");
  }
  async function save() {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/v1/import/rows/${row.id}/resolution`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        payload: imports ? payload : null,
        targetId: action === "use_existing" || action === "replace_existing" ? targetId : null,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setMessage(body.error || "Could not save this decision.");
    setMessage("Decision saved");
    onSaved(body.resolvedRows);
  }
  return (
    <article className={`reconciliation-row ${row.resolvedAt ? "resolved" : "pending"}`}>
      <header>
        <div>
          <span>
            {row.sourceSheet} · row {row.sourceRow}
          </span>
          <h3>
            {String(
              payload.title ??
                payload.dish ??
                payload.ingredient ??
                payload.item ??
                payload.topic ??
                "Workbook row",
            )}
          </h3>
        </div>
        <strong>{row.resolvedAt ? "Resolved" : "Decision needed"}</strong>
      </header>
      <ul className="issue-list">
        {row.messages.map((issue, index) => (
          <li key={index}>{issue}</li>
        ))}
      </ul>
      <div className="reconciliation-controls">
        <label>
          What should happen?
          <select
            disabled={readOnly}
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setMessage("");
            }}
          >
            {actions.map((option) => (
              <option value={option} key={option}>
                {actionLabels[option]}
              </option>
            ))}
          </select>
        </label>
        {(action === "use_existing" || action === "replace_existing") && (
          <label>
            Existing record
            <select
              disabled={readOnly}
              required
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="">Choose a match</option>
              {databaseCandidates.map((candidate) => (
                <option key={candidate.id!} value={candidate.id!}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {imports && (
        <div className="payload-editor">
          {Object.entries(payload).map(([key, value]) => {
            const options = constrainedOptions(row.destinationType, key);
            const wide =
              key === "notes" ||
              key === "feedback" ||
              key === "detail" ||
              key === "nextTimeChanges" ||
              key === "leftoverPrepLink";
            return (
              <label className={wide ? "span-two" : ""} key={key}>
                {labels[key] ?? key}
                {key === "packedLunch" ? (
                  <select
                    disabled={readOnly}
                    value={value == null ? "null" : String(value)}
                    onChange={(event) =>
                      update(
                        key,
                        event.target.value === "null" ? null : event.target.value === "true",
                      )
                    }
                  >
                    <option value="null">Not applicable</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : options ? (
                  <select
                    disabled={readOnly}
                    value={value == null ? "" : String(value)}
                    onChange={(event) => update(key, event.target.value)}
                  >
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {optionLabel(option)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    disabled={readOnly}
                    type={
                      dateFields.has(key)
                        ? "date"
                        : numberFields.has(key)
                          ? "number"
                          : key === "recipeUrl"
                            ? "url"
                            : "text"
                    }
                    step={numberFields.has(key) ? "any" : undefined}
                    value={value == null ? "" : String(value)}
                    onChange={(event) => update(key, event.target.value)}
                  />
                )}
              </label>
            );
          })}
        </div>
      )}
      <details>
        <summary>Original workbook cells</summary>
        <dl className="raw-payload">
          {Object.entries(row.rawPayload).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value == null ? <em>blank</em> : String(value)}</dd>
            </div>
          ))}
        </dl>
      </details>
      <footer>
        <span className={message && message !== "Decision saved" ? "form-error" : "muted"}>
          {message}
        </span>
        {!readOnly && (
          <button
            className="primary-button"
            disabled={
              busy || ((action === "use_existing" || action === "replace_existing") && !targetId)
            }
            onClick={save}
          >
            {busy ? "Saving…" : "Save decision"}
          </button>
        )}
      </footer>
    </article>
  );
}

export function ImportReconciliation({
  batch,
  rows,
  timeZone,
}: {
  batch: Batch;
  rows: ImportReconciliationRow[];
  timeZone: string;
}) {
  const router = useRouter();
  const [resolved, setResolved] = useState(batch.resolvedRows);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const unresolved = rows.filter((row) => !row.resolvedAt);
  async function acceptSuggestions() {
    if (
      !window.confirm(
        `Accept the suggested action for ${unresolved.length} unresolved row${unresolved.length === 1 ? "" : "s"}? You can still revisit each decision before cutover.`,
      )
    )
      return;
    setBulkBusy(true);
    setBulkError("");
    for (const row of unresolved) {
      const candidates = row.duplicateCandidates.filter(
        (candidate) => candidate.id && !candidate.synthetic,
      );
      const targetId = candidates[0]?.id ?? null;
      const action = row.suggestedAction ?? "skip";
      const response = await fetch(`/api/v1/import/rows/${row.id}/resolution`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          payload: row.normalizedPayload,
          targetId: action === "use_existing" || action === "replace_existing" ? targetId : null,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setBulkError(
          `${row.sourceSheet} row ${row.sourceRow}: ${body.error || "resolution failed"}`,
        );
        setBulkBusy(false);
        router.refresh();
        return;
      }
    }
    setBulkBusy(false);
    router.refresh();
  }
  async function aiReconcile() {
    setBulkBusy(true);
    setBulkError("");
    try {
      const response = await fetch(`/api/v1/import/batches/${batch.id}/ai-reconcile`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setBulkError(body.error || "AI reconciliation failed.");
      }
    } catch (problem) {
      setBulkError(problem instanceof Error ? problem.message : "AI reconciliation failed.");
    } finally {
      setBulkBusy(false);
      router.refresh();
    }
  }
  const ready = resolved >= batch.reconciliationRows && !batch.committedAt;
  return (
    <div className="page-stack">
      <section className="section-card reconciliation-summary">
        <header>
          <div>
            <h2>{batch.sourceFilename}</h2>
            <p className="muted">
              Only rows needing judgment are shown below. The other{" "}
              {batch.sourceRows - batch.reconciliationRows} rows are staged for automatic validated
              import.
            </p>
          </div>
          <span className={`status-chip ${ready ? "ready" : "warning"}`}>
            {batch.committedAt
              ? "Committed"
              : ready
                ? "Ready for cutover"
                : `${resolved} of ${batch.reconciliationRows} resolved`}
          </span>
        </header>
        <div className="preview-metrics">
          <span>
            {batch.sourceRows}
            <small>source rows</small>
          </span>
          <span>
            {batch.acceptedRows}
            <small>clean</small>
          </span>
          <span>
            {batch.reconciliationRows}
            <small>decisions</small>
          </span>
          <span>
            {resolved}
            <small>resolved</small>
          </span>
        </div>
        {unresolved.length > 0 && (
          <div className="refinement-actions" style={{ marginTop: "1rem" }}>
            <button className="secondary-button" disabled={bulkBusy} onClick={aiReconcile}>
              {bulkBusy ? "Running AI…" : "Auto-resolve with AI (gpt-5.4)"}
            </button>
            {unresolved.length > 1 && (
              <button className="secondary-button" disabled={bulkBusy} onClick={acceptSuggestions}>
                {bulkBusy ? "Saving suggestions…" : "Accept all suggested actions"}
              </button>
            )}
          </div>
        )}
        {bulkError && <p className="form-error">{bulkError}</p>}
      </section>
      {rows.map((row) => (
        <RowEditor
          key={row.id}
          row={row}
          readOnly={Boolean(batch.committedAt)}
          onSaved={(count) => {
            setResolved(count);
            router.refresh();
          }}
        />
      ))}
      {rows.length === 0 && (
        <section className="section-card">
          <p>No reconciliation decisions are required for this batch.</p>
        </section>
      )}
      <section className={`section-card cutover-command ${ready ? "ready" : "locked"}`}>
        <header>
          <h2>{batch.committedAt ? "Cutover completed" : "Final cutover"}</h2>
        </header>
        {batch.committedAt ? (
          <p>This batch was committed on {formatHouseholdDateTime(batch.committedAt, timeZone)}.</p>
        ) : ready ? (
          <>
            <p>
              All decisions are saved. From the Kitchen Planner source directory on Unraid, run:
            </p>
            <code>./unraid.sh cutover {batch.id} COMMIT</code>
            <p className="muted">
              The command creates a fresh database backup first, commits the entire batch in one
              transaction, disables starter-data mode and prints the exact rollback command.
            </p>
          </>
        ) : (
          <p>Resolve every required row before the guarded cutover command becomes available.</p>
        )}
      </section>
    </div>
  );
}
