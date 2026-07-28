import type { Metadata } from "next";
import Link from "next/link";
import { ImportReconciliation } from "@/components/import-reconciliation";
import { requirePageSession } from "@/lib/auth/session";
import { getHouseholdTimezone, getImportBatchDetail } from "@/lib/db/queries";
export const metadata: Metadata = { title: "Workbook reconciliation" };
export default async function ImportBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const session = await requirePageSession();
  const [detail, timeZone] = await Promise.all([
    getImportBatchDetail(session.householdId, (await params).batchId),
    getHouseholdTimezone(session.householdId),
  ]);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Owner-controlled import</span>
          <h1>Workbook reconciliation</h1>
          <p>Choose what happens to every ambiguous or duplicate row before production cutover.</p>
        </div>
        <Link className="secondary-button" href="/settings">
          Back to settings
        </Link>
      </div>
      {session.role !== "owner" ? (
        <section className="section-card">
          <p>Only the household owner can change reconciliation decisions.</p>
        </section>
      ) : (
        <ImportReconciliation batch={detail.batch} rows={detail.rows} timeZone={timeZone} />
      )}
    </div>
  );
}
