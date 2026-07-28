ALTER TYPE ai_workflow ADD VALUE IF NOT EXISTS 'recipe_import';
ALTER TYPE ai_workflow ADD VALUE IF NOT EXISTS 'flyer_extraction';

ALTER TABLE recipes
  ADD COLUMN source_type text NOT NULL DEFAULT 'external_link'
    CHECK (source_type IN ('household','external_link','imported_text','imported_file')),
  ADD COLUMN description text,
  ADD COLUMN cuisine text,
  ADD COLUMN meal_types text[] NOT NULL DEFAULT '{}',
  ADD COLUMN servings integer CHECK (servings IS NULL OR servings > 0),
  ADD COLUMN prep_minutes integer CHECK (prep_minutes IS NULL OR prep_minutes >= 0),
  ADD COLUMN cook_minutes integer CHECK (cook_minutes IS NULL OR cook_minutes >= 0),
  ADD COLUMN ingredients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN instructions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN favorite boolean NOT NULL DEFAULT false,
  ADD COLUMN recipe_status text NOT NULL DEFAULT 'proven'
    CHECK (recipe_status IN ('proven','experimental','avoid')),
  ADD COLUMN freezer_friendly boolean NOT NULL DEFAULT false,
  ADD COLUMN leftover_friendly boolean NOT NULL DEFAULT false,
  ADD COLUMN packed_lunch_friendly boolean NOT NULL DEFAULT false,
  ADD COLUMN created_by uuid REFERENCES household_users(id) ON DELETE SET NULL,
  ADD COLUMN archived_at timestamptz;

CREATE INDEX recipes_active_household_idx
  ON recipes (household_id,favorite DESC,updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE flyer_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  store_name text NOT NULL,
  store_location text,
  valid_from date NOT NULL,
  valid_until date NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('image','pdf','url','manual')),
  source_url text,
  original_filename text,
  mime_type text,
  storage_path text,
  source_checksum text,
  status text NOT NULL DEFAULT 'review'
    CHECK (status IN ('review','committed','archived')),
  extraction_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES household_users(id) ON DELETE SET NULL,
  committed_by uuid REFERENCES household_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  archived_at timestamptz,
  CHECK (valid_until >= valid_from)
);

CREATE INDEX flyer_sources_household_dates_idx
  ON flyer_sources (household_id,status,valid_from,valid_until);

CREATE TABLE flyer_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flyer_source_id uuid NOT NULL REFERENCES flyer_sources(id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  item text NOT NULL,
  brand text,
  package_size text,
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  pricing_unit text,
  multi_buy_quantity integer CHECK (multi_buy_quantity IS NULL OR multi_buy_quantity > 0),
  member_only boolean NOT NULL DEFAULT false,
  limit_text text,
  notes text,
  confidence numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  evidence_text text,
  source_reference text,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','accepted','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX flyer_sale_items_source_idx
  ON flyer_sale_items (flyer_source_id,status,item);
CREATE INDEX flyer_sale_items_active_lookup_idx
  ON flyer_sale_items (household_id,status,item);
