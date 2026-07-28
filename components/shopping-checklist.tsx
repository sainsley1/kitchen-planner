"use client";

import { useState } from "react";
import type { DemoShoppingItem } from "@/lib/types";

export function ShoppingChecklist({ initialItems }: { initialItems: DemoShoppingItem[] }) {
  const [items, setItems] = useState(initialItems);
  return (
    <div className="shopping-list">
      {items.map((item) => (
        <label
          className={item.purchased ? "shopping-row purchased" : "shopping-row"}
          key={item.id}
        >
          <input
            type="checkbox"
            checked={item.purchased}
            onChange={() =>
              setItems((current) =>
                current.map((candidate) =>
                  candidate.id === item.id
                    ? { ...candidate, purchased: !candidate.purchased }
                    : candidate,
                ),
              )
            }
          />
          <span>
            <strong>{item.item}</strong>
            <small>{item.category}</small>
          </span>
          <em>{item.quantity}</em>
        </label>
      ))}
      <p className="demo-disclaimer">
        Checkboxes are local demo state and reset when the page reloads.
      </p>
    </div>
  );
}
