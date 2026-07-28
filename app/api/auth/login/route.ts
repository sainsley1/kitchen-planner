import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateUser, createSession, SESSION_COOKIE } from "@/lib/auth/session";

const loginSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  pin: z.string().min(4).max(64),
});
const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: NextRequest) {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "lan-client";
  const now = Date.now();
  const prior = attempts.get(key);
  if (prior && prior.resetAt > now && prior.count >= 10) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in 15 minutes." },
      { status: 429 },
    );
  }
  if (!prior || prior.resetAt <= now) attempts.set(key, { count: 0, resetAt: now + 15 * 60_000 });

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Enter a household member and PIN." }, { status: 400 });
  const user = await authenticateUser(parsed.data.displayName, parsed.data.pin);
  if (!user) {
    const active = attempts.get(key)!;
    active.count += 1;
    return NextResponse.json({ error: "The name or PIN was not accepted." }, { status: 401 });
  }

  attempts.delete(key);
  const session = await createSession(user);
  const response = NextResponse.json({ user: { displayName: user.displayName, role: user.role } });
  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/",
    expires: session.expiresAt,
  });
  return response;
}
