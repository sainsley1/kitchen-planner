import { NextResponse } from "next/server";
import { appConfig } from "@/lib/config";
import { databaseHealth } from "@/lib/db/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const database = await databaseHealth();
  const ready = database === "connected" || (appConfig.demoMode && database === "not-configured");
  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      version: appConfig.version,
      demoMode: appConfig.demoMode,
      authMode: appConfig.authMode,
      database,
      aiConfigured: appConfig.aiConfigured,
    },
    { status: ready ? 200 : 503 },
  );
}
