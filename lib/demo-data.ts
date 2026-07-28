import type { DemoFeedback, DemoInventoryItem, DemoMeal, DemoShoppingItem } from "./types";

export const demoInventory: DemoInventoryItem[] = [
  {
    id: "demo-1",
    name: "Halloumi",
    detail: "Unopened block",
    quantity: "225 g",
    location: "Fridge · Top shelf",
    priority: "Use soon",
  },
  {
    id: "demo-2",
    name: "Chickpeas",
    detail: "Canned",
    quantity: "3 cans",
    location: "Pantry · Top shelf",
    priority: "Normal",
  },
  {
    id: "demo-3",
    name: "Cherry tomatoes",
    detail: "Fresh",
    quantity: "1 pint",
    location: "Fridge · Produce drawer",
    priority: "Use now",
  },
  {
    id: "demo-4",
    name: "Jasmine rice",
    detail: "Bulk container",
    quantity: "1.4 kg",
    location: "Pantry · Bottom shelf",
    priority: "Normal",
  },
  {
    id: "demo-5",
    name: "Lemons",
    detail: "Fresh",
    quantity: "4",
    location: "Fridge · Produce drawer",
    priority: "Use soon",
  },
  {
    id: "demo-6",
    name: "Frozen peas",
    detail: "Resealed bag",
    quantity: "600 g",
    location: "Freezer · Bottom drawer",
    priority: "Normal",
  },
];

export const demoMeals: DemoMeal[] = [
  {
    day: "Monday",
    breakfast: "Yogurt, fruit & granola",
    lunch: "Roasted vegetable wrap",
    dinner: "Lemon halloumi rice",
    status: "Completed",
  },
  {
    day: "Tuesday",
    breakfast: "Overnight oats",
    lunch: "Leftover halloumi rice",
    dinner: "Thai chickpea curry",
    status: "Planned",
  },
  {
    day: "Wednesday",
    breakfast: "Pancakes",
    lunch: "Leftover curry",
    dinner: "Mushroom tacos",
    status: "Planned",
  },
  {
    day: "Thursday",
    breakfast: "Egg-and-cheese toast",
    lunch: "Mushroom taco bowl",
    dinner: "Tomato-basil pasta",
    status: "Planned",
  },
  {
    day: "Friday",
    breakfast: "Fruit, nuts & yogurt",
    lunch: "Leftover pasta",
    dinner: "Homemade pizza",
    status: "Planned",
  },
  {
    day: "Saturday",
    breakfast: "Open breakfast slot",
    lunch: "—",
    dinner: "—",
    status: "Open",
  },
];

export const demoShopping: DemoShoppingItem[] = [
  {
    id: "shop-1",
    item: "Plain yogurt",
    category: "Dairy",
    quantity: "1 tub",
    purchased: false,
  },
  {
    id: "shop-2",
    item: "Fresh mint",
    category: "Produce",
    quantity: "1 bunch",
    purchased: false,
  },
  {
    id: "shop-3",
    item: "Whole wheat pitas",
    category: "Bakery",
    quantity: "1 pack",
    purchased: true,
  },
  {
    id: "shop-4",
    item: "Cat litter",
    category: "Pet supplies",
    quantity: "1 box",
    purchased: false,
  },
];

export const demoFeedback: DemoFeedback[] = [
  {
    id: "feedback-1",
    dish: "Lemon halloumi rice",
    person: "Alex",
    rating: "Love",
    note: "Bright flavour and a good weeknight portion.",
    decision: "Repeat",
  },
  {
    id: "feedback-2",
    dish: "Roasted vegetable wrap",
    person: "Jordan",
    rating: "Like",
    note: "Good packed lunch; keep the sauce separate.",
    decision: "Repeat with changes",
  },
];

export const demoDashboard = {
  inventoryCount: demoInventory.length,
  useNowCount: demoInventory.filter((item) => item.priority === "Use now").length,
  shoppingOpenCount: demoShopping.filter((item) => !item.purchased).length,
  nextPackedLunch: "Leftover halloumi rice",
};
