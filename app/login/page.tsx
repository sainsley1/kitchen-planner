import { redirect } from "next/navigation";
import { getCurrentSession, listActiveHouseholdUserNames } from "@/lib/auth/session";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage() {
  if (await getCurrentSession()) redirect("/");
  const displayNames = await listActiveHouseholdUserNames();
  return (
    <div className="login-page">
      <div className="login-card">
        <span className="brand-mark">K</span>
        <span className="eyebrow">LAN household access</span>
        <h1>Welcome to your kitchen</h1>
        <p>Choose your name and enter the PIN configured on WALLY.</p>
        <LoginForm displayNames={displayNames} />
      </div>
    </div>
  );
}
