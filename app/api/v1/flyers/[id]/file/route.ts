import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { getFlyerFile } from "@/lib/services/flyers";
export const runtime = "nodejs";
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const file = await getFlyerFile(actor, (await params).id);
    return new NextResponse(file.bytes, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.originalFilename)}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
