import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { checkWeeklyPlanRecipeSource } from "@/lib/services/weekly-refinement";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json(
      await checkWeeklyPlanRecipeSource(actor, (await params).id, await request.json()),
    );
  } catch (error) {
    return apiError(error);
  }
}
