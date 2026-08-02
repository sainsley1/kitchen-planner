import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { importRecipeDraft } from "@/lib/services/recipes";
import { MAX_RECIPE_UPLOAD_BYTES, MAX_RECIPE_UPLOAD_LABEL } from "@/lib/upload-limits";

export const runtime = "nodejs";

const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-m4a",
  "audio/m4a",
]);

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
      if (file.size > MAX_RECIPE_UPLOAD_BYTES)
        return NextResponse.json(
          { error: `Recipe file exceeds ${MAX_RECIPE_UPLOAD_LABEL}` },
          { status: 413 },
        );
      if (!ALLOWED.has(file.type))
        return NextResponse.json(
          { error: "Use an image, PDF, video (MP4, MOV, WebM) or audio file" },
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
