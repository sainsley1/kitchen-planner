"use client";

import { useMemo, useState } from "react";
import type { DemoInventoryItem } from "@/lib/types";

export function InventoryBrowser({ items }: { items: DemoInventoryItem[] }) {
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("All");
  const visible = useMemo(() => items.filter((item) => {
    const queryMatches = `${item.name} ${item.detail} ${item.location}`.toLowerCase().includes(query.toLowerCase());
    return queryMatches && (priority === "All" || item.priority === priority);
  }), [items, priority, query]);

  return <>
    <div className="toolbar"><input aria-label="Search inventory" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ingredients or locations" /><select aria-label="Filter by priority" value={priority} onChange={(event) => setPriority(event.target.value)}><option>All</option><option>Use now</option><option>Use soon</option><option>Normal</option><option>Reserved</option></select></div>
    <div className="inventory-list">{visible.map((item) => <article className="inventory-row" key={item.id}><div><strong>{item.name}</strong><span>{item.detail}</span></div><div><strong>{item.quantity}</strong><span>{item.location}</span></div><span className={`priority priority-${item.priority.toLowerCase().replace(" ", "-")}`}>{item.priority}</span></article>)}</div>
    {!visible.length && <p className="empty-state">No demo items match this filter.</p>}
  </>;
}
