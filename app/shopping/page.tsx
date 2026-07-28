import type { Metadata } from "next";
import { ShoppingManager } from "@/components/shopping-manager";
import { requirePageSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import {
  listGroceryRegistrationInventory,
  listShopping,
  listStorageLocations,
} from "@/lib/db/queries";

export const metadata: Metadata = { title: "Shopping" };
export default async function ShoppingPage() {
  const session = await requirePageSession();
  const [items, locations, inventory] = await Promise.all([
    listShopping(session.householdId),
    listStorageLocations(session.householdId),
    listGroceryRegistrationInventory(session.householdId),
  ]);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {items.filter((item) => item.status === "to_buy").length} to buy
          </span>
          <h1>Shopping list</h1>
          <p>
            Mark purchases, then register the grocery shop to put them into their storage locations.
          </p>
        </div>
      </div>
      <section className="section-card">
        <ShoppingManager
          initialItems={items}
          locations={locations}
          inventory={inventory}
          aiConfigured={appConfig.aiConfigured}
        />
      </section>
    </div>
  );
}
