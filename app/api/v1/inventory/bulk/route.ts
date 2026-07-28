import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { bulkArchiveInventory, bulkUpdateInventory } from "@/lib/services/mutations";
import { inventoryBulkInput } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    const value = inventoryBulkInput.parse(await request.json());
    const result =
      value.action === "archive"
        ? await bulkArchiveInventory(actor, value.ids, value.addToShopping)
        : await bulkUpdateInventory(actor, value.ids, value.patch);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
