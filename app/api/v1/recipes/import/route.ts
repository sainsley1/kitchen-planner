import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { importRecipeDraft } from "@/lib/services/recipes";
export const runtime = "nodejs";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
export async function POST(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const form = await request.formData();
    const text = String(form.get("text") ?? "").trim() || null;
    const sourceUrl = String(form.get("sourceUrl") ?? "").trim() || null;
    const file = form.get("file");
    let attachment;
    if (file instanceof File && file.size) {
      if (file.size > MAX_BYTES)
        return NextResponse.json({ error: "Recipe file exceeds 10 MB" }, { status: 413 });
      if (!ALLOWED.has(file.type))
        return NextResponse.json(
          { error: "Use a PNG, JPEG, WebP or PDF recipe file" },
          { status: 400 },
        );
      attachment = {
        filename: file.name,
        mimeType: file.type,
        bytes: Buffer.from(await file.arrayBuffer()),
      };
    }
    return NextResponse.json(await importRecipeDraft(actor, { text, sourceUrl }, attachment));
  } catch (error) {
    return apiError(error);
  }
}
