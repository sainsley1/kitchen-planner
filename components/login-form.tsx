"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ displayNames }: { displayNames: string[] }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(displayNames[0] ?? "");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName, pin }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setError(body.error || "Sign-in failed.");
    router.push("/");
    router.refresh();
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label>
        Household member
        <select value={displayName} onChange={(event) => setDisplayName(event.target.value)}>
          {displayNames.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        PIN
        <input
          autoComplete="current-password"
          inputMode="numeric"
          type="password"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="primary-button" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
