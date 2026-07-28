"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TimezoneSettings({
  currentTimeZone,
  timeZones,
  canManage,
}: {
  currentTimeZone: string;
  timeZones: string[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [timeZone, setTimeZone] = useState(currentTimeZone);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/v1/settings/timezone", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeZone }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setMessage(body.error || "Could not update the time zone.");
    setMessage("Time zone updated.");
    router.refresh();
  }
  return (
    <div className="timezone-setting">
      <label>
        Household time zone
        <select
          disabled={!canManage || busy}
          value={timeZone}
          onChange={(event) => {
            setTimeZone(event.target.value);
            setMessage("");
          }}
        >
          {timeZones.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <button
        className="secondary-button"
        disabled={!canManage || busy || timeZone === currentTimeZone}
        onClick={save}
      >
        {busy ? "Saving…" : "Save time zone"}
      </button>
      {message && <small>{message}</small>}
      {!canManage && <small>Only the household owner can change this setting.</small>}
    </div>
  );
}
