import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { supersedeFoodPreference, updateFoodPreference } from "@/lib/services/preferences";
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json({
      item: await updateFoodPreference(actor, (await params).id, await request.json()),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json({ item: await supersedeFoodPreference(actor, (await params).id) });
  } catch (error) {
    return apiError(error);
  }
}
