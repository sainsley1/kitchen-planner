import type { Metadata } from "next";
import Link from "next/link";
import { FlyerManager } from "@/components/flyer-manager";
import { requirePageSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { getHouseholdTimezone, listFlyers } from "@/lib/db/queries";
import { householdDateKey } from "@/lib/datetime";
export const metadata: Metadata = { title: "Flyers & sales" };
export default async function FlyersPage() {
  const session = await requirePageSession();
  const [items, timeZone] = await Promise.all([
    listFlyers(session.householdId),
    getHouseholdTimezone(session.householdId),
  ]);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Reviewed sale evidence</span>
          <h1>Flyers & sales</h1>
          <p>
            Capture advertised prices, reconcile extraction mistakes, and expose only verified
            current specials to weekly planning.
          </p>
        </div>
        <Link className="secondary-button" href="/recipes">
          Recipe repository
        </Link>
      </div>
      <FlyerManager
        items={items}
        aiConfigured={appConfig.aiConfigured}
        today={householdDateKey(new Date(), timeZone)}
      />
    </div>
  );
}
