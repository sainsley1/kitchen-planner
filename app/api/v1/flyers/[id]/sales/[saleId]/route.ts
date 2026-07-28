import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { decideFlyerSale, prioritizeFlyerSale, updateFlyerSale } from "@/lib/services/flyers";
const priorityInput = z.object({ prioritized: z.boolean() });
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; saleId: string }> },
) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const ids = await params;
    const body = await request.json();
    const item =
      "item" in body
        ? await updateFlyerSale(actor, ids.id, ids.saleId, body)
        : "prioritized" in body
          ? await prioritizeFlyerSale(
              actor,
              ids.id,
              ids.saleId,
              priorityInput.parse(body).prioritized,
            )
          : await decideFlyerSale(actor, ids.id, ids.saleId, body);
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
