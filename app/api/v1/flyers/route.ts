import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { listFlyers } from "@/lib/db/queries";
import { apiError } from "@/lib/http";
import { createFlyer } from "@/lib/services/flyers";
export async function GET() {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ items: await listFlyers(actor.householdId) });
}
export async function POST(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json(
      { item: await createFlyer(actor, body, undefined, false) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
