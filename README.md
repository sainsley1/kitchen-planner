# 🥗 Kitchen Planner

**Version 0.7.0** — An intelligent, self-hosted household meal planner, recipe manager, and flyer price intelligence system powered by Next.js and PostgreSQL.

---

## 🌟 What's New in Version 0.7.0

Version 0.7.0 introduces major enhancements to AI recipe ingestion, grocery flyer circular price intelligence, automated deal grading, and weekly meal plan savings optimization:

- 📷 **Native Mobile Camera Photo Capture & AI Recipe Ingestion**:
  - Capture recipe pages or cookbooks directly using native mobile camera controls (`capture="environment"`).
  - Automatically extracts structured recipe details, ingredients, yields, instructions, and **`flavor_asset:`** tags (marinades, pastes, aromatics, seasonings, and sauces) for smart meal pairing.

- 📈 **Smart Price Index & Historical Baseline Engine**:
  - PostgreSQL migration `0017` introduces historical price tracking (`flyer_item_price_history`) across stores over time.
  - Normalizes package sizes into unified rate bases (`$/lb`, `$/kg`, `$/fl_oz`, `$/each`).
  - Computes 90-day store price averages and assigns automatic **Deal Grades**:
    - **`🔥 A+ Steal`**: $\ge 35\%$ discount (All-Time Low)
    - **`Grade A`**: $25\% - 34\%$ discount
    - **`Grade B`**: $15\% - 24\%$ discount
    - **`Grade C`**: Standard / Minor Discount
    - **`⚠️ Grade F`**: Artificially Inflated Baseline (>30% above 90-day store average)

- 📰 **Flyer Ingestion & Circular Review UI Upgrade**:
  - Snap circular photos on mobile with touch-optimized camera buttons.
  - Filter extracted circular items by store department (Produce, Meat & Seafood, Dairy, Pantry, Bakery, Frozen).
  - Displays color-coded Deal Grade Badges and normalized unit rates (`$/lb`, `$/kg`) on sale cards.
  - **1-Click Batch Review**: Accept high-confidence items ($\ge 85\%$) or reject low-confidence items ($< 60\%$) with a single tap.

- 🤖 **Deal-Grade & Flavor-Asset Driven Meal Planner**:
  - Opportunity ranking engine weights A+ steals (+40 pts) and flavor asset pairing (+12 pts), while penalizing fake deals (-50 pts).
  - Instructs the AI planner to anchor 2–4 Grade A+/A sales per week and pair them with pantry flavor assets to minimize net grocery shortfalls.

- 💰 **Estimated Weekly Grocery Plan Savings & Value Badges**:
  - Prominent **Glassmorphism Savings Banner** (`💰 Estimated Weekly Plan Savings: ~$XX.XX`) displaying total plan savings and summary chips for `🔥 A+ Steals` and `🌿 Flavor Assets`.
  - Per-meal value badges on read-only meal cards (`🔥 A+ Sale Anchor: Atlantic Salmon`, `🌿 Flavor Asset: garlic`).

- 🔄 **AI Import Reconciliation**:
  - Batch import reconciliation workflow with duplicate candidate detection, resolution tracking, and 1-click batch actions.

---

## ⚡ Core Features

- **Household Cookbook**: Manage original recipes, external links, and imported text/photo recipes with status filters (`proven`, `experimental`, `do-not-suggest`).
- **Flyer & Circular Intelligence**: Extract sales from paper circulars (photos/PDFs) or digital URLs, view confidence scores, and verify sales before committing.
- **Smart Weekly Planner**: Generate full-week meal plans balancing household preferences, active sales, pantry inventory, and nutritional variety.
- **Deterministic Inventory Reconciliation**: Reconciles ingredient requirements against stock in `kg`/`g`, `lb`/`oz`, `L`/`ml`, and `each`; generates shopping lists only for true shortfalls.
- **Privacy & Safety First**: Server-side OpenAI API key handling, structured output validation, single-transaction PostgreSQL mutations, and complete audit history (`source=ai`).

---

## 🚀 Quick Start (Unraid & Docker)

### 1. Environment Configuration

Copy `.env.example` to `.env` and configure your credentials:

```bash
cp .env.example .env
nano .env
```

Ensure the following variables are configured:

```dotenv
POSTGRES_PASSWORD=your-secure-password
DATABASE_URL=postgresql://kitchen_planner:your-secure-password@db:5432/kitchen_planner
APP_VERSION=0.7.0
OPENAI_API_KEY=your-openai-project-api-key
```

### 2. Installation / Upgrade

Run the included management script:

```bash
chmod +x unraid.sh
./unraid.sh update
./unraid.sh status
```

`./unraid.sh update` automatically backs up PostgreSQL, builds the Docker image, and applies migrations through `0017_price_history_and_deal_scoring.sql`.

---

## 🧪 Verification & Testing

Validate the repository codebase using pinned tools:

```bash
npm ci
npm run format:check
npm run typecheck
npm run test:run
npx vitest run tests/release-version.test.ts
npm run build
npm run verify:runtime
npm run verify:runner
```

---

## 📚 Documentation

- [docs/MAINTAINER_GUIDE.md](docs/MAINTAINER_GUIDE.md): Architecture, change-to-file mapping, and release workflows.
- [docs/AI_WORKFLOWS.md](docs/AI_WORKFLOWS.md): AI routing, prompt limits, structured output schemas, and cost accounting.
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md): PostgreSQL schema and entity definitions.
- [docs/UNRAID_7_1_2.md](docs/UNRAID_7_1_2.md): Step-by-step Unraid deployment guide.
