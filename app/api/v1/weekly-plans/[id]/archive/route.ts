import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { archiveWeeklyPlan } from "@/lib/services/weekly-planning";

const idSchema = z.string().uuid();

export async function POST(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json(
      await archiveWeeklyPlan(actor, idSchema.parse((await context.params).id)),
    );
  } catch (error) {
    return apiError(error);
  }
}
