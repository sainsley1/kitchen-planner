import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { updateHouseholdTimezone } from "@/lib/services/mutations";

export async function PATCH(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json({
      household: await updateHouseholdTimezone(actor, await request.json()),
    });
  } catch (error) {
    return apiError(error);
  }
}
