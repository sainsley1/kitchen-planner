import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { reviseWeeklyPlan } from "@/lib/services/weekly-planning";
const idSchema = z.string().uuid();
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json({
      plan: await reviseWeeklyPlan(
        actor,
        idSchema.parse((await context.params).id),
        await request.json(),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
