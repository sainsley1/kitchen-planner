export type InventoryPriority = "Normal" | "Use soon" | "Use now" | "Reserved";

export type DemoInventoryItem = {
  id: string;
  name: string;
  detail: string;
  quantity: string;
  location: string;
  priority: InventoryPriority;
};

export type DemoMeal = {
  day: string;
  breakfast: string;
  lunch: string;
  dinner: string;
  status: "Planned" | "Completed" | "Open";
};

export type DemoShoppingItem = {
  id: string;
  item: string;
  category: string;
  quantity: string;
  purchased: boolean;
};

export type DemoFeedback = {
  id: string;
  dish: string;
  person: string;
  rating: "Love" | "Like" | "Mixed" | "Dislike";
  note: string;
  decision: string;
};
