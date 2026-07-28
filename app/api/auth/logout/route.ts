import { NextResponse } from "next/server";
import { revokeCurrentSession, SESSION_COOKIE } from "@/lib/auth/session";

export async function POST() {
  await revokeCurrentSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/",
    maxAge: 0,
  });
  return response;
}
