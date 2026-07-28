import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { listMeals } from "@/lib/db/queries";
import { apiError } from "@/lib/http";
import { createMeal } from "@/lib/services/mutations";
export async function GET(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const p = request.nextUrl.searchParams;
  return NextResponse.json({
    items: await listMeals(actor.householdId, p.get("from") ?? undefined, p.get("to") ?? undefined),
  });
}
export async function POST(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json(
      { item: await createMeal(actor, await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
