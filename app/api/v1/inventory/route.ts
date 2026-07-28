import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { listInventory } from "@/lib/db/queries";
import { apiError } from "@/lib/http";
import { createInventory } from "@/lib/services/mutations";

export async function GET() {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ items: await listInventory(actor.householdId) });
}
export async function POST(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json(
      { item: await createInventory(actor, await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
