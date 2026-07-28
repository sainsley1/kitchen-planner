import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Kitchen Planner", template: "%s · Kitchen Planner" },
  description: "Household inventory, shopping and meal planning in one source of truth.",
  applicationName: "Kitchen Planner",
};

export const viewport: Viewport = {
  themeColor: "#153f35",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getCurrentSession();
  return (
    <html lang="en">
      <body>
        <AppShell
          currentUser={session ? { displayName: session.displayName, role: session.role } : null}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
