import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { createFlyer } from "@/lib/services/flyers";
import { flyerExceedsUploadLimit, MAX_FLYER_UPLOAD_LABEL } from "@/lib/upload-limits";
export const runtime = "nodejs";
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
export async function POST(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    let attachment;
    if (file instanceof File && file.size) {
      if (flyerExceedsUploadLimit(file.size))
        return NextResponse.json(
          { error: `Flyer file exceeds the ${MAX_FLYER_UPLOAD_LABEL} upload limit` },
          { status: 413 },
        );
      if (!ALLOWED.has(file.type))
        return NextResponse.json(
          { error: "Use a PNG, JPEG, WebP or PDF flyer file" },
          { status: 400 },
        );
      attachment = {
        filename: file.name,
        mimeType: file.type,
        bytes: Buffer.from(await file.arrayBuffer()),
      };
    }
    const value = {
      storeName: String(form.get("storeName") ?? ""),
      storeLocation: String(form.get("storeLocation") ?? "").trim() || null,
      validFrom: String(form.get("validFrom") ?? ""),
      validUntil: String(form.get("validUntil") ?? ""),
      sourceUrl: String(form.get("sourceUrl") ?? "").trim() || null,
    };
    const extract = String(form.get("extract") ?? "true") !== "false";
    return NextResponse.json(
      { item: await createFlyer(actor, value, attachment, extract) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
