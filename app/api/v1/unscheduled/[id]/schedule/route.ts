import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { scheduleUnscheduled } from "@/lib/services/mutations";

const idSchema = z.string().uuid();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const id = idSchema.parse((await context.params).id);
    return NextResponse.json(
      { item: await scheduleUnscheduled(actor, id, await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
