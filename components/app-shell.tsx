"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";

const navigation = [
  { href: "/", label: "Today", icon: "⌂" },
  { href: "/inventory", label: "Inventory", icon: "▦" },
  { href: "/meal-plan", label: "Meal plan", icon: "◫" },
  { href: "/shopping", label: "Shopping", icon: "✓" },
  { href: "/recipes", label: "Recipes", icon: "▤" },
  { href: "/flyers", label: "Flyers", icon: "$" },
  { href: "/assistant", label: "Assistant", icon: "✦" },
  { href: "/feedback", label: "Preferences", icon: "♡" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function AppShell({
  children,
  currentUser,
}: {
  children: React.ReactNode;
  currentUser: { displayName: string; role: string } | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === "/login") return <>{children}</>;
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Kitchen Planner home">
          <span className="brand-mark">K</span>
          <span>
            <strong>Kitchen Planner</strong>
            <small>Household source of truth</small>
          </span>
        </Link>
        <nav className="side-nav" aria-label="Primary navigation">
          {navigation.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "nav-link active" : "nav-link"}
              >
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" />
          Database connected
          <br />
          <small>
            {currentUser ? `${currentUser.displayName} · ${currentUser.role}` : "Sign-in required"}
          </small>
          {currentUser && (
            <button className="sidebar-logout" onClick={logout}>
              Sign out
            </button>
          )}
        </div>
      </aside>
      <div className="page-column">
        <header className="mobile-header">
          <Link className="mobile-brand" href="/">
            <span className="brand-mark">K</span>
            <strong>Kitchen Planner</strong>
          </Link>
          <span className="demo-pill">{currentUser?.displayName ?? "Locked"}</span>
        </header>
        <main className="page-content">{children}</main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {navigation.slice(0, 5).map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? "bottom-link active" : "bottom-link"}
            >
              <span aria-hidden>{item.icon}</span>
              <small>{item.label}</small>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
