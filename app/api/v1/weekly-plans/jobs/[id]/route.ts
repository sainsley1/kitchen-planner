import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { getWeeklyPlanJob, scheduleWeeklyPlanJob } from "@/lib/services/weekly-planning";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const { id } = await params;
    const job = await getWeeklyPlanJob(actor, id);
    if (job.status === "queued") scheduleWeeklyPlanJob(job.id);
    return NextResponse.json({ job });
  } catch (error) {
    return apiError(error);
  }
}
