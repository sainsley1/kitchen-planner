import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function apiError(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: "Validation failed", details: error.flatten() },
      { status: 400 },
    );
  const message = error instanceof Error ? error.message : "Unexpected request failure";
  const status = message === "Record not found" ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}
