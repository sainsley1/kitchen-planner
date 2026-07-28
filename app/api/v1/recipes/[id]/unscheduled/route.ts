import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { addRecipeToUnscheduled } from "@/lib/services/recipes";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json(
      { item: await addRecipeToUnscheduled(actor, (await params).id, await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
