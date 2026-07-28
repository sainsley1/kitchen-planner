import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { getDashboard } from "@/lib/db/queries";

export async function GET() {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ mode: "database", ...(await getDashboard(actor.householdId)) });
}
