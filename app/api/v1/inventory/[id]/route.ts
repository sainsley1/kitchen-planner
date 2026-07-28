import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { archiveInventory, consumeInventory, updateInventory } from "@/lib/services/mutations";
import { consumeInventoryInput } from "@/lib/validation";

const idSchema = z.string().uuid();
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const id = idSchema.parse((await context.params).id);
    const body = await request.json();
    const consume = consumeInventoryInput.safeParse(body);
    const addToShopping = request.nextUrl.searchParams.get("addToShopping") === "true";
    const item = consume.success
      ? await consumeInventory(
          actor,
          id,
          consume.data.amount,
          consume.data.reason,
          consume.data.addToShopping,
        )
      : await updateInventory(actor, id, body, addToShopping);
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const id = idSchema.parse((await context.params).id);
    const addToShopping = request.nextUrl.searchParams.get("addToShopping") === "true";
    return NextResponse.json({ item: await archiveInventory(actor, id, addToShopping) });
  } catch (error) {
    return apiError(error);
  }
}
