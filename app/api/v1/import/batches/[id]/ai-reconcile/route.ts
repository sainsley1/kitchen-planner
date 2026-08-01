import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { reconcileImportBatchWithAi } from "@/lib/services/import-reconciliation-ai";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "owner")
    return NextResponse.json(
      { error: "Only a household owner can reconcile an import batch." },
      { status: 403 },
    );

  try {
    const { id } = await context.params;
    const result = await reconcileImportBatchWithAi(actor, id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}
