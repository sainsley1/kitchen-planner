import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { applyWeeklyPlanSuggestion } from "@/lib/services/weekly-refinement";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; suggestionId: string }> },
) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const values = await params;
    return NextResponse.json({
      result: await applyWeeklyPlanSuggestion(
        actor,
        values.id,
        values.suggestionId,
        await request.json(),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
