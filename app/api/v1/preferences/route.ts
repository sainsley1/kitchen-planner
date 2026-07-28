import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { listFoodPreferences } from "@/lib/db/queries";
import { createFoodPreference } from "@/lib/services/preferences";
export async function GET() {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ items: await listFoodPreferences(actor.householdId) });
}
export async function POST(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json(
      { item: await createFoodPreference(actor, await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
