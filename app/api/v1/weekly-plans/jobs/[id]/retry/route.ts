import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { retryWeeklyPlanJob, scheduleWeeklyPlanJob } from "@/lib/services/weekly-planning";
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const job = await retryWeeklyPlanJob(actor, (await params).id);
    scheduleWeeklyPlanJob(job.id);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
