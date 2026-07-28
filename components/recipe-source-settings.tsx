"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RecipeSourcePreferences } from "@/lib/ai/contracts";

function lines(value: string) {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
export function RecipeSourceSettings({
  initial,
  canManage,
}: {
  initial: RecipeSourcePreferences;
  canManage: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/v1/settings/recipe-sources", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setMessage(body.error || "Could not save recipe-source preferences.");
    setValue(body.settings);
    setMessage("Recipe-source preferences saved.");
    router.refresh();
  }
  return (
    <div className="recipe-source-settings">
      <div className="form-grid">
        <label>
          Preferred publishers
          <textarea
            disabled={!canManage || busy}
            value={value.preferredDomains.join("\n")}
            onChange={(event) =>
              setValue((current) => ({ ...current, preferredDomains: lines(event.target.value) }))
            }
            placeholder="recipetineats.com"
          />
        </label>
        <label>
          Blocked publishers
          <textarea
            disabled={!canManage || busy}
            value={value.blockedDomains.join("\n")}
            onChange={(event) =>
              setValue((current) => ({ ...current, blockedDomains: lines(event.target.value) }))
            }
            placeholder="example.com"
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            disabled={!canManage || busy}
            checked={value.preferSavedRecipes}
            onChange={(event) =>
              setValue((current) => ({ ...current, preferSavedRecipes: event.target.checked }))
            }
          />
          Prefer saved household recipes
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            disabled={!canManage || busy}
            checked={value.allowVideoSources}
            onChange={(event) =>
              setValue((current) => ({ ...current, allowVideoSources: event.target.checked }))
            }
          />
          Allow video-first sources
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            disabled={!canManage || busy}
            checked={value.allowPaywalledSources}
            onChange={(event) =>
              setValue((current) => ({ ...current, allowPaywalledSources: event.target.checked }))
            }
          />
          Allow paywalled sources
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            disabled={!canManage || busy}
            checked={value.allowRegistrationSources}
            onChange={(event) =>
              setValue((current) => ({
                ...current,
                allowRegistrationSources: event.target.checked,
              }))
            }
          />
          Allow registration-required sources
        </label>
      </div>
      <div className="form-actions">
        <button className="secondary-button" disabled={!canManage || busy} onClick={save}>
          {busy ? "Saving…" : "Save source preferences"}
        </button>
      </div>
      {message && <small>{message}</small>}
      {!canManage && <small>Only the household owner can change these settings.</small>}
    </div>
  );
}
