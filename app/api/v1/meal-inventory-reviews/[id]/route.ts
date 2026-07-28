import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { resolveMealInventoryReview } from "@/lib/services/mutations";

const idSchema = z.string().uuid();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json(
      await resolveMealInventoryReview(
        actor,
        idSchema.parse((await params).id),
        await request.json(),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
