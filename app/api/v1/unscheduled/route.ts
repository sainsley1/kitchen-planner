import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { listUnscheduled } from "@/lib/db/queries";
import { apiError } from "@/lib/http";
import { createUnscheduled } from "@/lib/services/mutations";

export async function GET(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const p = request.nextUrl.searchParams;
  return NextResponse.json({
    items: await listUnscheduled(
      actor.householdId,
      p.get("from") ?? undefined,
      p.get("to") ?? undefined,
    ),
  });
}
export async function POST(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json(
      { item: await createUnscheduled(actor, await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
