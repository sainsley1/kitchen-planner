import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { listAuditEvents } from "@/lib/db/queries";
import { apiError } from "@/lib/http";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const rows = await listAuditEvents(actor.householdId, query.limit + 1, query.offset);
    return NextResponse.json({
      items: rows.slice(0, query.limit),
      hasMore: rows.length > query.limit,
    });
  } catch (error) {
    return apiError(error);
  }
}
