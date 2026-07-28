import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { commitFlyer } from "@/lib/services/flyers";
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json({ item: await commitFlyer(actor, (await params).id) });
  } catch (error) {
    return apiError(error);
  }
}
