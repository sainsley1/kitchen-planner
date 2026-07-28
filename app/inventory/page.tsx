import type { Metadata } from "next";
import { InventoryManager } from "@/components/inventory-manager";
import { requirePageSession } from "@/lib/auth/session";
import { listInventory, listStorageLocations } from "@/lib/db/queries";
export const metadata: Metadata = { title: "Inventory" };
export default async function InventoryPage() {
  const session = await requirePageSession();
  const [items, locations] = await Promise.all([
    listInventory(session.householdId),
    listStorageLocations(session.householdId),
  ]);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{items.length} active records</span>
          <h1>Inventory</h1>
          <p>
            Create, move, consume and archive stock. Every change is retained in the audit history.
          </p>
        </div>
      </div>
      <div className="section-card inventory-card">
        <InventoryManager items={items} locations={locations} />
      </div>
    </div>
  );
}
