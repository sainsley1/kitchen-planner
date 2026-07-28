CREATE TYPE user_role AS ENUM ('owner', 'member');
CREATE TYPE inventory_priority AS ENUM ('normal', 'use_soon', 'use_now', 'reserved');
CREATE TYPE package_state AS ENUM ('sealed', 'opened', 'full', 'partial', 'nearly_empty', 'unknown');
CREATE TYPE meal_type AS ENUM ('breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'prep');
CREATE TYPE meal_status AS ENUM ('planned', 'completed', 'changed', 'deferred', 'skipped', 'open', 'unconfirmed');
CREATE TYPE shopping_status AS ENUM ('to_buy', 'purchased', 'deferred', 'removed');
CREATE TYPE preference_status AS ENUM ('active', 'contextual', 'superseded');
CREATE TYPE audit_source AS ENUM ('ui', 'ai', 'import', 'system');
CREATE TYPE import_status AS ENUM ('pending', 'valid', 'warning', 'rejected', 'committed');

CREATE TABLE households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Vancouver',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE household_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  role user_role NOT NULL DEFAULT 'member',
  pin_hash text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT household_user_name_uq UNIQUE (household_id, display_name)
);

CREATE TABLE storage_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name text NOT NULL,
  detail text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT storage_location_uq UNIQUE NULLS NOT DISTINCT (household_id, name, detail)
);

CREATE TABLE inventory_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  ingredient text NOT NULL,
  brand_variety text,
  category text NOT NULL,
  quantity numeric(12,3),
  unit text,
  storage_location_id uuid REFERENCES storage_locations(id) ON DELETE SET NULL,
  storage_detail text,
  package_state package_state NOT NULL DEFAULT 'unknown',
  best_before date,
  priority inventory_priority NOT NULL DEFAULT 'normal',
  notes text,
  archived_at timestamptz,
  legacy_source jsonb,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_household_idx ON inventory_entries(household_id);
CREATE INDEX inventory_priority_idx ON inventory_entries(household_id, priority);

CREATE TABLE recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title text NOT NULL,
  source_url text,
  planned_yield text,
  tags text[] NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE food_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id uuid REFERENCES household_users(id) ON DELETE CASCADE,
  topic text NOT NULL,
  classification text NOT NULL,
  detail text NOT NULL,
  context text,
  status preference_status NOT NULL DEFAULT 'active',
  effective_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE meal_plan_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  meal_date date NOT NULL,
  meal_type meal_type NOT NULL,
  assigned_user_id uuid REFERENCES household_users(id) ON DELETE SET NULL,
  dish text NOT NULL,
  recipe_id uuid REFERENCES recipes(id) ON DELETE SET NULL,
  planned_yield text,
  packed_lunch boolean,
  leftover_prep_link text,
  status meal_status NOT NULL DEFAULT 'planned',
  notes text,
  legacy_source jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meal_plan_date_idx ON meal_plan_entries(household_id, meal_date);

CREATE TABLE meal_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id uuid REFERENCES household_users(id) ON DELETE SET NULL,
  recipe_id uuid REFERENCES recipes(id) ON DELETE SET NULL,
  meal_plan_entry_id uuid REFERENCES meal_plan_entries(id) ON DELETE SET NULL,
  feedback_date date NOT NULL,
  dish text NOT NULL,
  rating text NOT NULL,
  feedback text NOT NULL,
  next_time_changes text,
  repeat_decision text,
  legacy_source jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shopping_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  item text NOT NULL,
  category text,
  quantity numeric(12,3),
  unit text,
  preferred_store text,
  priority text NOT NULL DEFAULT 'normal',
  status shopping_status NOT NULL DEFAULT 'to_buy',
  notes text,
  inventory_entry_id uuid REFERENCES inventory_entries(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staple_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  ingredient text NOT NULL,
  category text,
  target_minimum numeric(12,3),
  unit text,
  preferred_brand text,
  current_status text,
  reorder_rule text,
  notes text,
  reviewed_at timestamptz
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES household_users(id) ON DELETE SET NULL,
  source audit_source NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  reason text,
  before_state jsonb,
  after_state jsonb,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_idempotency_uq UNIQUE (household_id, idempotency_key)
);

CREATE TABLE import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  source_filename text NOT NULL,
  source_checksum text NOT NULL,
  dry_run boolean NOT NULL DEFAULT true,
  status import_status NOT NULL DEFAULT 'pending',
  source_rows integer NOT NULL DEFAULT 0,
  accepted_rows integer NOT NULL DEFAULT 0,
  warning_rows integer NOT NULL DEFAULT 0,
  rejected_rows integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  source_sheet text NOT NULL,
  source_row integer NOT NULL,
  status import_status NOT NULL DEFAULT 'pending',
  raw_payload jsonb NOT NULL,
  normalized_payload jsonb,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  committed_entity_type text,
  committed_entity_id uuid
);

CREATE TABLE app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_setting_key_uq UNIQUE (household_id, key)
);
