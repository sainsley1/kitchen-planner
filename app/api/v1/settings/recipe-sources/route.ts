import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import {
  getRecipeSourcePreferences,
  setRecipeSourcePreferences,
} from "@/lib/services/recipe-source-settings";

export async function GET() {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ settings: await getRecipeSourcePreferences(actor.householdId) });
}
export async function PATCH(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json({
      settings: await setRecipeSourcePreferences(actor, await request.json()),
    });
  } catch (error) {
    return apiError(error);
  }
}
