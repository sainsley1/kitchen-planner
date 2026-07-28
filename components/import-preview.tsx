"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Result = {
  batchId: string;
  filename: string;
  dryRun: boolean;
  sourceRows: number;
  acceptedRows: number;
  warningRows: number;
  rejectedRows: number;
  reconciliationRows: number;
  sampleWarnings: Array<{
    sheet: string;
    row: number;
    status: string;
    messages: string[];
    suggestedAction: string;
  }>;
};

export function ImportPreview() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    const data = new FormData();
    data.set("workbook", file);
    const response = await fetch("/api/v1/import/preview", { method: "POST", body: data });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setError(body.error || "Preview failed.");
    setResult(body);
    router.refresh();
  }
  return (
    <div className="import-preview">
      <form onSubmit={submit}>
        <input
          type="file"
          accept=".xlsx"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <button className="primary-button" disabled={!file || busy}>
          {busy ? "Analysing…" : "Stage workbook"}
        </button>
      </form>
      <p className="muted">
        Staging never changes production records. Rows needing judgment must be reconciled before
        the guarded cutover can run.
      </p>
      {error && <p className="form-error">{error}</p>}
      {result && (
        <div className="preview-result">
          <strong>Staging complete: {result.filename}</strong>
          <div className="preview-metrics">
            <span>
              {result.sourceRows}
              <small>rows</small>
            </span>
            <span>
              {result.acceptedRows}
              <small>clean</small>
            </span>
            <span>
              {result.reconciliationRows}
              <small>decisions</small>
            </span>
            <span>
              {result.rejectedRows}
              <small>blocked</small>
            </span>
          </div>
          <Link className="primary-button preview-link" href={`/settings/import/${result.batchId}`}>
            Open reconciliation
          </Link>
        </div>
      )}
    </div>
  );
}
