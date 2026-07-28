import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { archiveExpiredFlyers } from "@/lib/services/flyers";

export async function POST() {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json(await archiveExpiredFlyers(actor));
  } catch (error) {
    return apiError(error);
  }
}
