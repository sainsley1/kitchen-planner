import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { listWeeklyPlans } from "@/lib/db/queries";
import { apiError } from "@/lib/http";
import { queueWeeklyPlan, scheduleWeeklyPlanJob } from "@/lib/services/weekly-planning";

export async function GET() {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ items: await listWeeklyPlans(actor.householdId) });
}
export async function POST(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const job = await queueWeeklyPlan(actor, await request.json());
    scheduleWeeklyPlanJob(job.id);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
