import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL is not configured; skipping household bootstrap.");
  process.exit(0);
}

const householdName = process.env.APP_HOUSEHOLD_NAME || "Kitchen";
const users = [
  {
    name: process.env.HOUSEHOLD_USER_1_NAME || "Owner",
    pin: process.env.HOUSEHOLD_USER_1_PIN || "",
    role: "owner",
  },
  {
    name: process.env.HOUSEHOLD_USER_2_NAME || "Member",
    pin: process.env.HOUSEHOLD_USER_2_PIN || "",
    role: "member",
  },
];

function hashPin(pin) {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${scryptSync(pin, salt, 32).toString("hex")}`;
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  let household = await client.query(
    "SELECT id FROM households WHERE name=$1 ORDER BY created_at LIMIT 1",
    [householdName],
  );
  if (!household.rowCount)
    household = await client.query(
      "INSERT INTO households (name,timezone) VALUES ($1,'America/Vancouver') RETURNING id",
      [householdName],
    );
  const householdId = household.rows[0].id;

  for (const user of users) {
    await client.query(
      `INSERT INTO household_users (household_id,display_name,role,pin_hash)
      VALUES ($1,$2,$3,$4) ON CONFLICT (household_id,display_name) DO NOTHING`,
      [householdId, user.name, user.role, user.pin ? hashPin(user.pin) : null],
    );
    if (user.pin)
      await client.query(
        `UPDATE household_users SET pin_hash=COALESCE(pin_hash,$3) WHERE household_id=$1 AND display_name=$2`,
        [householdId, user.name, hashPin(user.pin)],
      );
  }

  const locations = [
    ["Fridge", "Top shelf", 1],
    ["Fridge", "Middle shelf", 2],
    ["Fridge", "Bottom shelf", 3],
    ["Fridge", "Produce drawer", 4],
    ["Freezer", "Top shelf", 10],
    ["Freezer", "Top drawer", 11],
    ["Freezer", "Bottom drawer", 12],
    ["Pantry", "Top shelf", 20],
    ["Pantry", "Middle shelf", 21],
    ["Pantry", "Bottom shelf", 22],
    ["Counter", "Main area", 30],
  ];
  for (const location of locations)
    await client.query(
      `INSERT INTO storage_locations (household_id,name,detail,sort_order) VALUES ($1,$2,$3,$4)
    ON CONFLICT (household_id,name,detail) DO UPDATE SET active=true,sort_order=EXCLUDED.sort_order`,
      [householdId, ...location],
    );

  if (process.env.SEED_SYNTHETIC_DATA === "true") {
    const inventoryCount = await client.query(
      "SELECT count(*)::int AS count FROM inventory_entries WHERE household_id=$1",
      [householdId],
    );
    if (inventoryCount.rows[0].count === 0) {
      const fixtures = [
        [
          "Halloumi",
          "Unopened block",
          "Dairy & Eggs",
          225,
          "g",
          "Fridge",
          "Top shelf",
          "sealed",
          "use_soon",
        ],
        [
          "Chickpeas",
          "Canned",
          "Canned & Jarred",
          3,
          "can",
          "Pantry",
          "Top shelf",
          "sealed",
          "normal",
        ],
        [
          "Cherry tomatoes",
          "Fresh",
          "Produce",
          1,
          "pint",
          "Fridge",
          "Produce drawer",
          "opened",
          "use_now",
        ],
        [
          "Jasmine rice",
          "Bulk container",
          "Grains & Pasta",
          1.4,
          "kg",
          "Pantry",
          "Bottom shelf",
          "partial",
          "normal",
        ],
        ["Lemons", "Fresh", "Produce", 4, "each", "Fridge", "Produce drawer", "opened", "use_soon"],
        [
          "Frozen peas",
          "Resealed bag",
          "Produce",
          600,
          "g",
          "Freezer",
          "Bottom drawer",
          "partial",
          "normal",
        ],
      ];
      for (const row of fixtures)
        await client.query(
          `INSERT INTO inventory_entries (household_id,ingredient,brand_variety,category,quantity,unit,storage_location_id,storage_detail,package_state,priority,notes,verified_at)
        SELECT $1,$2,$3,$4,$5,$6,l.id,$8,$9,$10,'Synthetic Phase 3 fixture',now() FROM storage_locations l
        WHERE l.household_id=$1 AND l.name=$7 AND l.detail=$8 LIMIT 1`,
          [householdId, ...row],
        );
    }

    const shoppingCount = await client.query(
      "SELECT count(*)::int AS count FROM shopping_items WHERE household_id=$1",
      [householdId],
    );
    if (shoppingCount.rows[0].count === 0)
      await client.query(
        `INSERT INTO shopping_items (household_id,item,category,quantity,unit,status,notes) VALUES
      ($1,'Plain yogurt','Dairy',1,'tub','to_buy','Synthetic fixture'),($1,'Fresh mint','Produce',1,'bunch','to_buy','Synthetic fixture'),
      ($1,'Whole wheat pitas','Bakery',1,'pack','purchased','Synthetic fixture'),($1,'Cat litter','Pet supplies',1,'box','to_buy','Synthetic fixture')`,
        [householdId],
      );

    const mealCount = await client.query(
      "SELECT count(*)::int AS count FROM meal_plan_entries WHERE household_id=$1",
      [householdId],
    );
    if (mealCount.rows[0].count === 0)
      await client.query(
        `INSERT INTO meal_plan_entries (household_id,meal_date,meal_type,dish,status,notes) VALUES
      ($1,current_date,'breakfast','Yogurt, fruit & granola','planned','Synthetic fixture'),($1,current_date,'lunch','Roasted vegetable wrap','planned','Synthetic fixture'),
      ($1,current_date,'dinner','Lemon halloumi rice','planned','Synthetic fixture'),($1,current_date+1,'breakfast','Overnight oats','planned','Synthetic fixture'),
      ($1,current_date+1,'lunch','Leftover halloumi rice','planned','Synthetic fixture'),($1,current_date+1,'dinner','Thai chickpea curry','planned','Synthetic fixture')`,
        [householdId],
      );
  }

  await client.query("COMMIT");
  if (process.env.AUTH_MODE === "household" && users.some((user) => !user.pin))
    console.warn("Household auth is enabled but one or more initial PIN variables are empty.");
  console.log(`Household bootstrap complete for ${householdName}.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
