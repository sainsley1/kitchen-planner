import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { parseWorkbookPreview } from "@/lib/import/workbook-preview";
import { normalizeWorkbookRow } from "@/lib/import/workbook-normalize";
import { stageWorkbook } from "@/lib/services/import-staging";

export const runtime = "nodejs";
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "owner")
    return NextResponse.json(
      { error: "Only a household owner can stage a workbook." },
      { status: 403 },
    );
  try {
    const form = await request.formData();
    const file = form.get("workbook");
    if (!(file instanceof File))
      return NextResponse.json({ error: "Choose an .xlsx workbook." }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".xlsx"))
      return NextResponse.json(
        { error: "Only macro-free .xlsx files are accepted." },
        { status: 400 },
      );
    if (file.size > MAX_BYTES)
      return NextResponse.json(
        { error: "Workbook exceeds the 5 MB preview limit." },
        { status: 413 },
      );

    const bytes = Buffer.from(await file.arrayBuffer());
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const parsed = (await parseWorkbookPreview(bytes)).map(normalizeWorkbookRow);
    return NextResponse.json(await stageWorkbook(actor, { filename: file.name, checksum }, parsed));
  } catch (error) {
    return apiError(error);
  }
}
