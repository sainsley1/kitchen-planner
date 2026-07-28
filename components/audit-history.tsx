"use client";

import { useState } from "react";
import type { AuditRecord } from "@/lib/db/queries";
import { formatHouseholdDateTime } from "@/lib/datetime";

function label(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function display(value: unknown) {
  if (value == null || value === "") return <em>empty</em>;
  if (typeof value === "object") return <pre>{JSON.stringify(value, null, 2)}</pre>;
  return String(value);
}
function changes(event: AuditRecord) {
  const before = record(event.beforeState);
  const after = record(event.afterState);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !same(before[key], after[key]))
    .sort()
    .map((key) => ({ key, before: before[key], after: after[key] }));
}

export function AuditHistory({
  initialItems,
  initialHasMore,
  timeZone,
}: {
  initialItems: AuditRecord[];
  initialHasMore: boolean;
  timeZone: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function loadMore() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/v1/audit?offset=${items.length}&limit=10`);
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setError(body.error || "Could not load more audit history.");
    setItems((current) => [...current, ...body.items]);
    setHasMore(body.hasMore);
  }
  return (
    <div className="audit-history">
      <div className="audit-list">
        {items.map((event) => {
          const changed = changes(event);
          return (
            <details className="audit-event" key={event.id}>
              <summary>
                <span>
                  <strong>{event.actor ?? "System"}</strong>
                  <small>{formatHouseholdDateTime(event.createdAt, timeZone)}</small>
                </span>
                <p>
                  {label(event.action)} · {label(event.entityType)}
                  {event.reason ? ` — ${event.reason}` : ""}
                </p>
              </summary>
              <div className="audit-detail">
                <dl>
                  <div>
                    <dt>Source</dt>
                    <dd>{label(event.source)}</dd>
                  </div>
                  {event.entityId && (
                    <div>
                      <dt>Record ID</dt>
                      <dd>
                        <code>{event.entityId}</code>
                      </dd>
                    </div>
                  )}
                </dl>
                {changed.length ? (
                  <div className="audit-diff">
                    {changed.map((change) => (
                      <div key={change.key}>
                        <strong>{label(change.key)}</strong>
                        <span>
                          <small>Before</small>
                          {display(change.before)}
                        </span>
                        <span>
                          <small>After</small>
                          {display(change.after)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No field-level change was stored for this event.</p>
                )}
              </div>
            </details>
          );
        })}
        {!items.length && <p className="muted">No application changes have been recorded yet.</p>}
      </div>
      {error && <p className="form-error">{error}</p>}
      {hasMore && (
        <button className="secondary-button audit-more" disabled={busy} onClick={loadMore}>
          {busy ? "Loading…" : "View 10 more"}
        </button>
      )}
    </div>
  );
}
