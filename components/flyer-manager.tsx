"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { FlyerRecord, FlyerSaleRecord } from "@/lib/db/queries";

type SaleForm = {
  item: string;
  brand: string;
  category: string;
  packageSize: string;
  price: string;
  regularPrice: string;
  savingsAmount: string;
  discountPercent: string;
  pricingUnit: string;
  multiBuyQuantity: string;
  memberOnly: boolean;
  limitText: string;
  notes: string;
  confidence: string;
  evidenceText: string;
  sourceReference: string;
  status: "proposed" | "accepted" | "rejected";
  prioritized: boolean;
};
const emptySale: SaleForm = {
  item: "",
  brand: "",
  category: "",
  packageSize: "",
  price: "",
  regularPrice: "",
  savingsAmount: "",
  discountPercent: "",
  pricingUnit: "",
  multiBuyQuantity: "",
  memberOnly: false,
  limitText: "",
  notes: "",
  confidence: "",
  evidenceText: "",
  sourceReference: "",
  status: "accepted",
  prioritized: false,
};
function saleForm(sale?: FlyerSaleRecord): SaleForm {
  return sale
    ? {
        item: sale.item,
        brand: sale.brand ?? "",
        category: sale.category ?? "",
        packageSize: sale.packageSize ?? "",
        price: sale.price,
        regularPrice: sale.regularPrice ?? "",
        savingsAmount: sale.savingsAmount ?? "",
        discountPercent: sale.discountPercent ?? "",
        pricingUnit: sale.pricingUnit ?? "",
        multiBuyQuantity: sale.multiBuyQuantity?.toString() ?? "",
        memberOnly: sale.memberOnly,
        limitText: sale.limitText ?? "",
        notes: sale.notes ?? "",
        confidence: sale.confidence ?? "",
        evidenceText: sale.evidenceText ?? "",
        sourceReference: sale.sourceReference ?? "",
        status: sale.status as SaleForm["status"],
        prioritized: sale.prioritized,
      }
    : { ...emptySale };
}
function payload(form: SaleForm) {
  return {
    item: form.item,
    brand: form.brand || null,
    category: form.category || null,
    packageSize: form.packageSize || null,
    price: Number(form.price),
    regularPrice: form.regularPrice ? Number(form.regularPrice) : null,
    savingsAmount: form.savingsAmount ? Number(form.savingsAmount) : null,
    discountPercent: form.discountPercent ? Number(form.discountPercent) : null,
    pricingUnit: form.pricingUnit || null,
    multiBuyQuantity: form.multiBuyQuantity ? Number(form.multiBuyQuantity) : null,
    memberOnly: form.memberOnly,
    limitText: form.limitText || null,
    notes: form.notes || null,
    confidence: form.confidence ? Number(form.confidence) : null,
    evidenceText: form.evidenceText || null,
    sourceReference: form.sourceReference || null,
    status: form.status,
    prioritized: form.prioritized,
  };
}
async function jsonCall(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "Flyer action failed");
  return value;
}
function SaleEditor({
  form,
  setForm,
  onSave,
  onCancel,
  busy,
}: {
  form: SaleForm;
  setForm: (value: SaleForm) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const multiBuy = Number(form.multiBuyQuantity) > 1;
  return (
    <div className="flyer-sale-editor">
      <div className="form-grid">
        <label>
          Item
          <input
            required
            value={form.item}
            onChange={(event) => setForm({ ...form, item: event.target.value })}
          />
        </label>
        <label>
          Brand
          <input
            value={form.brand}
            onChange={(event) => setForm({ ...form, brand: event.target.value })}
          />
        </label>
        <label>
          Category
          <input
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
            placeholder="Produce"
          />
        </label>
        <label>
          Package size
          <input
            value={form.packageSize}
            onChange={(event) => setForm({ ...form, packageSize: event.target.value })}
            placeholder="800 g, 12 pack…"
          />
        </label>
        <label>
          {multiBuy ? "Multi-buy total price" : "Sale price"}
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            onChange={(event) => setForm({ ...form, price: event.target.value })}
          />
        </label>
        <label>
          {multiBuy ? "Regular price (each)" : "Regular price"}
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.regularPrice}
            onChange={(event) => setForm({ ...form, regularPrice: event.target.value })}
          />
        </label>
        <label>
          {multiBuy ? "Advertised savings (each)" : "Advertised savings"}
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.savingsAmount}
            onChange={(event) => setForm({ ...form, savingsAmount: event.target.value })}
          />
        </label>
        <label>
          Discount %
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={form.discountPercent}
            onChange={(event) => setForm({ ...form, discountPercent: event.target.value })}
          />
        </label>
        <label>
          Pricing unit
          <input
            value={form.pricingUnit}
            onChange={(event) => setForm({ ...form, pricingUnit: event.target.value })}
            placeholder="each, /lb…"
          />
        </label>
        <label>
          Multi-buy quantity
          <input
            type="number"
            min="1"
            value={form.multiBuyQuantity}
            onChange={(event) => setForm({ ...form, multiBuyQuantity: event.target.value })}
          />
        </label>
        <label>
          Status
          <select
            value={form.status}
            onChange={(event) =>
              setForm({ ...form, status: event.target.value as SaleForm["status"] })
            }
          >
            <option value="proposed">Proposed</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label>
          Confidence (0–1)
          <input
            type="number"
            min="0"
            max="1"
            step="any"
            value={form.confidence}
            onChange={(event) => setForm({ ...form, confidence: event.target.value })}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.memberOnly}
            onChange={(event) => setForm({ ...form, memberOnly: event.target.checked })}
          />
          Members only
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.prioritized}
            onChange={(event) => setForm({ ...form, prioritized: event.target.checked })}
          />
          Prioritize for meal planning
        </label>
        <label>
          Limit
          <input
            value={form.limitText}
            onChange={(event) => setForm({ ...form, limitText: event.target.value })}
          />
        </label>
        <label className="span-two">
          Notes
          <input
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </label>
        <label className="span-two">
          Visible evidence
          <input
            value={form.evidenceText}
            onChange={(event) => setForm({ ...form, evidenceText: event.target.value })}
          />
        </label>
        <label className="span-two">
          Page or image reference
          <input
            value={form.sourceReference}
            onChange={(event) => setForm({ ...form, sourceReference: event.target.value })}
          />
        </label>
      </div>
      <div className="form-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={busy || !form.item || form.price === ""}
          onClick={onSave}
        >
          Save sale
        </button>
      </div>
    </div>
  );
}

export function FlyerManager({
  items,
  aiConfigured,
  today,
}: {
  items: FlyerRecord[];
  aiConfigured: boolean;
  today: string;
}) {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [storeLocation, setStoreLocation] = useState("");
  const [validFrom, setValidFrom] = useState(today);
  const [validUntil, setValidUntil] = useState(today);
  const [sourceUrl, setSourceUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [extract, setExtract] = useState(aiConfigured);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<{ flyerId: string; saleId: string | null } | null>(null);
  const [form, setForm] = useState<SaleForm>({ ...emptySale });
  const expiredCount = items.filter((flyer) => flyer.validUntil < today).length;
  async function upload(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = new FormData();
      data.set("storeName", storeName);
      data.set("storeLocation", storeLocation);
      data.set("validFrom", validFrom);
      data.set("validUntil", validUntil);
      data.set("sourceUrl", sourceUrl);
      data.set("extract", String(extract));
      if (file) data.set("file", file);
      const response = await fetch("/api/v1/flyers/upload", { method: "POST", body: data });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Flyer upload failed");
      setMessage(
        body.item.extracted
          ? `${body.item.extracted} sale items extracted. Review each one before committing.`
          : "Flyer saved for manual review.",
      );
      setStoreName("");
      setStoreLocation("");
      setSourceUrl("");
      setFile(null);
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Flyer upload failed");
    } finally {
      setBusy(false);
    }
  }
  async function decide(flyerId: string, saleId: string, status: "accepted" | "rejected") {
    setBusy(true);
    setError("");
    try {
      await jsonCall(`/api/v1/flyers/${flyerId}/sales/${saleId}`, "PATCH", { status });
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Sale could not be reviewed");
    } finally {
      setBusy(false);
    }
  }
  async function saveSale() {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      const url = editing.saleId
        ? `/api/v1/flyers/${editing.flyerId}/sales/${editing.saleId}`
        : `/api/v1/flyers/${editing.flyerId}/sales`;
      await jsonCall(url, editing.saleId ? "PATCH" : "POST", payload(form));
      setEditing(null);
      setMessage("Sale item saved.");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Sale item could not be saved");
    } finally {
      setBusy(false);
    }
  }
  async function acceptHigh(flyer: FlyerRecord) {
    const selected = flyer.sales.filter(
      (sale) => sale.status === "proposed" && Number(sale.confidence ?? 0) >= 0.85,
    );
    if (!selected.length) {
      setMessage("No proposed items meet the 0.85 confidence threshold.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      for (const sale of selected)
        await jsonCall(`/api/v1/flyers/${flyer.id}/sales/${sale.id}`, "PATCH", {
          status: "accepted",
        });
      setMessage(
        `Accepted ${selected.length} high-confidence sale items. Review the rest individually.`,
      );
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Sales could not be accepted");
    } finally {
      setBusy(false);
    }
  }
  async function rejectLow(flyer: FlyerRecord) {
    const selected = flyer.sales.filter(
      (sale) => sale.status === "proposed" && Number(sale.confidence ?? 1) < 0.6,
    );
    if (!selected.length) {
      setMessage("No proposed items fall below the 0.60 confidence threshold.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      for (const sale of selected)
        await jsonCall(`/api/v1/flyers/${flyer.id}/sales/${sale.id}`, "PATCH", {
          status: "rejected",
        });
      setMessage(`Rejected ${selected.length} low-confidence sale items (<60%).`);
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Sales could not be rejected");
    } finally {
      setBusy(false);
    }
  }
  async function commit(flyer: FlyerRecord) {
    setBusy(true);
    setError("");
    try {
      await jsonCall(`/api/v1/flyers/${flyer.id}/commit`, "POST");
      setMessage(`${flyer.storeName} sales are now available to weekly planning.`);
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Flyer could not be committed");
    } finally {
      setBusy(false);
    }
  }
  async function archive(flyer: FlyerRecord) {
    if (!window.confirm(`Archive the ${flyer.storeName} flyer?`)) return;
    setBusy(true);
    setError("");
    try {
      await jsonCall(`/api/v1/flyers/${flyer.id}`, "DELETE");
      setMessage("Flyer archived.");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Flyer could not be archived");
    } finally {
      setBusy(false);
    }
  }
  async function archiveExpired() {
    if (
      !window.confirm(
        `Archive all ${expiredCount} expired flyer${expiredCount === 1 ? "" : "s"}? Their reviewed sales and audit history will be retained.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await jsonCall("/api/v1/flyers/archive-expired", "POST");
      setMessage(
        result.count
          ? `Archived ${result.count} expired flyer${result.count === 1 ? "" : "s"}.`
          : "No expired flyers remained.",
      );
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Expired flyers could not be archived");
    } finally {
      setBusy(false);
    }
  }
  async function prioritize(flyerId: string, sale: FlyerSaleRecord) {
    setBusy(true);
    setError("");
    try {
      await jsonCall(`/api/v1/flyers/${flyerId}/sales/${sale.id}`, "PATCH", {
        prioritized: !sale.prioritized,
      });
      setMessage(
        sale.prioritized
          ? `${sale.item} is no longer a priority sale.`
          : `${sale.item} will receive priority consideration in meal planning.`,
      );
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Sale priority could not be updated");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flyer-library">
      {expiredCount > 0 && (
        <section className="section-card expired-flyer-actions">
          <div>
            <strong>
              {expiredCount} expired flyer{expiredCount === 1 ? " is" : "s are"} still shown
            </strong>
            <p className="muted">Archive them together to keep current sales easy to review.</p>
          </div>
          <button className="secondary-button" disabled={busy} onClick={archiveExpired}>
            Archive all expired sales
          </button>
        </section>
      )}
      <section className="section-card">
        <header>
          <div>
            <h2>Add a flyer or sale sheet</h2>
            <p className="muted">
              Images, PDFs and public URLs can be extracted with AI. Manual entry remains available
              without AI.
            </p>
          </div>
        </header>
        <form className="entity-form" onSubmit={upload}>
          <div className="form-grid">
            <label>
              Store
              <input
                required
                value={storeName}
                onChange={(event) => setStoreName(event.target.value)}
                placeholder="Sabzi Mandi"
              />
            </label>
            <label>
              Location
              <input
                value={storeLocation}
                onChange={(event) => setStoreLocation(event.target.value)}
                placeholder="Victoria"
              />
            </label>
            <label>
              Valid from
              <input
                required
                type="date"
                value={validFrom}
                onChange={(event) => setValidFrom(event.target.value)}
              />
            </label>
            <label>
              Valid until
              <input
                required
                type="date"
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
              />
            </label>
            <label className="span-two">
              Public flyer URL
              <input
                type="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://…"
              />
            </label>
            <div className="span-two">
              <label style={{ display: "block", marginBottom: "6px" }}>Flyer image or PDF</label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <label
                  className="secondary-button"
                  style={{
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  📷 Snap Circular Photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: "none" }}
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <label
                  className="secondary-button"
                  style={{
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  📁 Choose File / PDF
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    style={{ display: "none" }}
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                {file && (
                  <span
                    style={{
                      fontSize: "13px",
                      color: "var(--ink-soft)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    ✓ {file.name} ({(file.size / 1024).toFixed(0)} KB)
                    <button
                      type="button"
                      style={{
                        border: 0,
                        background: "none",
                        color: "var(--danger)",
                        cursor: "pointer",
                        padding: 0,
                      }}
                      onClick={() => setFile(null)}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>
            </div>
            <label className="span-two checkbox-label">
              <input
                type="checkbox"
                disabled={!aiConfigured}
                checked={extract}
                onChange={(event) => setExtract(event.target.checked)}
              />
              Extract proposed sales with AI{!aiConfigured && " (OpenAI is not configured)"}
            </label>
          </div>
          <div className="form-actions">
            <button
              className="primary-button"
              disabled={busy || !storeName || (!file && !sourceUrl && extract)}
            >
              {busy ? "Processing…" : "Add for review"}
            </button>
          </div>
        </form>
        {error && <p className="form-error">{error}</p>}
        {message && <p className="form-success">{message}</p>}
      </section>
      <div className="flyer-card-list">
        {items.map((flyer) => {
          const proposed = flyer.sales.filter((sale) => sale.status === "proposed").length;
          const accepted = flyer.sales.filter((sale) => sale.status === "accepted").length;
          const expired = flyer.validUntil < today;
          return (
            <section className="section-card flyer-card" key={flyer.id}>
              <header>
                <div>
                  <span className="eyebrow">{flyer.storeLocation ?? flyer.sourceType}</span>
                  <h2>{flyer.storeName}</h2>
                  <p className="muted">
                    {flyer.validFrom} through {flyer.validUntil}
                  </p>
                </div>
                <div className="tag-row">
                  <span
                    className={`status-chip ${flyer.status === "committed" ? "ready" : "warning"}`}
                  >
                    {flyer.status}
                  </span>
                  {expired && <span className="status-chip">expired</span>}
                </div>
              </header>
              <div className="flyer-source-row">
                {flyer.hasFile && (
                  <a
                    className="secondary-button"
                    href={`/api/v1/flyers/${flyer.id}/file`}
                    target="_blank"
                  >
                    View source file ↗
                  </a>
                )}
                {flyer.sourceUrl && (
                  <a
                    className="secondary-button"
                    href={flyer.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open source URL ↗
                  </a>
                )}
                <span>
                  {accepted} accepted · {proposed} awaiting review · {flyer.sales.length} total
                </span>
              </div>
              {flyer.extractionWarnings.length > 0 && (
                <div className="plan-issues">
                  <strong>Extraction notes</strong>
                  <ul>
                    {flyer.extractionWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
              {flyer.status === "review" && (
                <div className="form-actions flyer-review-actions">
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => acceptHigh(flyer)}
                  >
                    Accept ≥85% confidence
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => rejectLow(flyer)}
                  >
                    Reject &lt;60% confidence
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      setEditing({ flyerId: flyer.id, saleId: null });
                      setForm({ ...emptySale });
                    }}
                  >
                    Add sale manually
                  </button>
                  <button
                    className="primary-button"
                    disabled={busy || proposed > 0 || accepted === 0}
                    onClick={() => commit(flyer)}
                  >
                    Commit reviewed flyer
                  </button>
                </div>
              )}
              {editing?.flyerId === flyer.id && editing.saleId === null && (
                <SaleEditor
                  form={form}
                  setForm={setForm}
                  onSave={saveSale}
                  onCancel={() => setEditing(null)}
                  busy={busy}
                />
              )}
              <div className="flyer-sale-list">
                {flyer.sales.map((sale) => {
                  const multiBuy = (sale.multiBuyQuantity ?? 1) > 1;
                  const grade = sale.dealGrade;
                  const gradeColor =
                    grade === "A+" || grade === "A"
                      ? { bg: "#e6f4ea", fg: "#137333", border: "#ceead6" }
                      : grade === "B"
                        ? { bg: "#e8f0fe", fg: "#1a73e8", border: "#d2e3fc" }
                        : grade === "F"
                          ? { bg: "#fce8e6", fg: "#c5221f", border: "#fad2cf" }
                          : { bg: "#f1f3f4", fg: "#5f6368", border: "#dadce0" };
                  return (
                    <article className={`flyer-sale ${sale.status}`} key={sale.id}>
                      {editing?.saleId === sale.id ? (
                        <SaleEditor
                          form={form}
                          setForm={setForm}
                          onSave={saveSale}
                          onCancel={() => setEditing(null)}
                          busy={busy}
                        />
                      ) : (
                        <>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <strong>
                                {sale.brand ? `${sale.brand} ` : ""}
                                {sale.item}
                              </strong>
                              {grade && (
                                <span
                                  style={{
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    background: gradeColor.bg,
                                    color: gradeColor.fg,
                                    border: `1px solid ${gradeColor.border}`,
                                  }}
                                  title={`Deal Grade: ${grade}`}
                                >
                                  {grade === "A+" ? "🔥 A+ Deal" : `Grade ${grade}`}
                                </span>
                              )}
                            </div>
                            <span>
                              {[
                                sale.category,
                                sale.packageSize,
                                sale.memberOnly ? "members only" : null,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "Package size not listed"}
                            </span>
                            {sale.evidenceText && <small>{sale.evidenceText}</small>}
                          </div>
                          <div className="sale-price">
                            <strong>
                              {multiBuy
                                ? `${sale.multiBuyQuantity} for $${Number(sale.price).toFixed(2)}`
                                : `$${Number(sale.price).toFixed(2)}`}
                            </strong>
                            <span>
                              {sale.normalizedUnitPrice
                                ? `$${Number(sale.normalizedUnitPrice).toFixed(2)} / ${sale.normalizedUnitMeasure}`
                                : (sale.pricingUnit ?? "")}
                            </span>
                            {sale.regularPrice && (
                              <small>
                                Regular ${Number(sale.regularPrice).toFixed(2)}
                                {multiBuy ? " each" : ""}
                                {sale.discountPercent
                                  ? ` · ${Number(sale.discountPercent).toFixed(0)}% off`
                                  : sale.savingsAmount
                                    ? ` · save $${Number(sale.savingsAmount).toFixed(2)}${multiBuy ? " each" : ""}`
                                    : ""}
                              </small>
                            )}
                            {sale.confidence && (
                              <small>{Math.round(Number(sale.confidence) * 100)}% confidence</small>
                            )}
                          </div>
                          <div className="tag-row">
                            <span
                              className={`status-chip ${sale.status === "accepted" ? "ready" : sale.status === "proposed" ? "warning" : ""}`}
                            >
                              {sale.status}
                            </span>
                            {sale.prioritized && (
                              <span className="status-chip ready">priority</span>
                            )}
                          </div>
                          <div className="row-actions">
                            {sale.status === "accepted" && (
                              <button
                                className={sale.prioritized ? "small-button" : "secondary-button"}
                                disabled={busy || expired}
                                onClick={() => prioritize(flyer.id, sale)}
                              >
                                {sale.prioritized ? "Unprioritize" : "Prioritize"}
                              </button>
                            )}
                            {flyer.status === "review" && (
                              <>
                                <button
                                  className="icon-button"
                                  title="Edit"
                                  onClick={() => {
                                    setEditing({ flyerId: flyer.id, saleId: sale.id });
                                    setForm(saleForm(sale));
                                  }}
                                >
                                  ✎
                                </button>
                                {sale.status === "proposed" && (
                                  <>
                                    <button
                                      className="small-button"
                                      disabled={busy}
                                      onClick={() => decide(flyer.id, sale.id, "accepted")}
                                    >
                                      Accept
                                    </button>
                                    <button
                                      className="danger-link"
                                      disabled={busy}
                                      onClick={() => decide(flyer.id, sale.id, "rejected")}
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
              <div className="form-actions">
                <button className="danger-link" disabled={busy} onClick={() => archive(flyer)}>
                  Archive flyer
                </button>
              </div>
            </section>
          );
        })}
        {!items.length && (
          <section className="section-card empty-state">
            No flyers yet. Add a current sale sheet above.
          </section>
        )}
      </div>
    </div>
  );
}
