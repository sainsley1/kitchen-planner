import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { resolveImportRow } from "@/lib/services/mutations";

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json(
      await resolveImportRow(
        actor,
        z
          .string()
          .uuid()
          .parse((await context.params).id),
        await request.json(),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
