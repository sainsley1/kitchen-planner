"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportBatchRecord } from "@/lib/db/queries";
import { formatHouseholdDateTime } from "@/lib/datetime";

export function ImportBatchList({
  batches,
  timeZone,
  canManage,
}: {
  batches: ImportBatchRecord[];
  timeZone: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function remove(batch: ImportBatchRecord) {
    if (
      !window.confirm(
        `Remove ${batch.sourceFilename} from the workbook import history shown here? Its audit record will be retained.`,
      )
    )
      return;
    setBusyId(batch.id);
    setError("");
    const response = await fetch(`/api/v1/import/batches/${batch.id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    setBusyId(null);
    if (!response.ok) return setError(body.error || "Could not remove the workbook import.");
    router.refresh();
  }
  return (
    <>
      <div className="batch-list">
        {batches.map((batch) => (
          <div key={batch.id}>
            <span>
              <strong>{batch.sourceFilename}</strong>
              <small>
                {formatHouseholdDateTime(batch.createdAt, timeZone)} ·{" "}
                {batch.committedAt ? "committed" : batch.status}
              </small>
            </span>
            <em>
              {batch.acceptedRows} clean · {batch.resolvedRows}/{batch.reconciliationRows} decisions
            </em>
            <div className="row-actions">
              <Link className="secondary-button" href={`/settings/import/${batch.id}`}>
                {batch.committedAt ? "View report" : "Reconcile"}
              </Link>
              {canManage && (
                <button
                  className="danger-button"
                  disabled={busyId === batch.id}
                  onClick={() => remove(batch)}
                >
                  {busyId === batch.id ? "Removing…" : "Remove"}
                </button>
              )}
            </div>
          </div>
        ))}
        {!batches.length && <p className="muted">No workbooks have been staged.</p>}
      </div>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}
