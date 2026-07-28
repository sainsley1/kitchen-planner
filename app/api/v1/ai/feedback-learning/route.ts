import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { generateFeedbackLearning } from "@/lib/services/ai-workflows";

export async function POST(request: NextRequest) {
  const actor = await getCurrentSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json(await generateFeedbackLearning(actor, await request.json()), {
      status: 201,
    });
  } catch (error) {
    return apiError(error);
  }
}
