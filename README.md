# Kitchen Planner

Version 0.6.5.1 preserves reviewed shopping exclusions and explicit inventory associations during repeated plan verification, keeps structured leftover sources intact, makes partial household coverage non-blocking, and reconciles regenerated prep tasks without duplication. Runtime-data ignore rules remain root-anchored so `lib/db` source is included in Git. Existing household users, PIN hashes, inventory, preferences and planning history remain unchanged during an upgrade.

## 0.6.5.1 workflows

0.6.5.1 retains the complete 0.6.5.0 workflow, including sanitized distributable defaults, database-driven login choices, editable draft shopping rows, bounded targeted-workflow recovery, warning persistence, conversion-aware inventory reconciliation, resilient multi-buy flyer extraction, ranked sale opportunities, ingredient-aware planning, multiple same-day prep items, selectable Balanced/Deep weekly planning, per-run cost visibility, direct-use cold-storage planning, grocery-restock repair, proposal archival, meal-day inventory review, Docker storage safeguards and the household recipe library.

- **Household cookbook:** add and edit original recipes, trusted external links and imported text, image or PDF recipes. Store structured ingredients, instructions, yield, timing, cuisine, meal types, favourite/proven/experimental/do-not-suggest status, and freezer/leftover/packed-lunch signals. AI imports create a review draft and never save automatically.
- **Recipe scheduling:** add a saved recipe to Unscheduled items, attach one to a draft meal, and see saved-recipe provenance in weekly-plan review. The selected weekly planner receives up to 60 ranked active recipes with capped ingredient/notes summaries and without full instruction text, keeping prompts bounded.
- **Flyers & sales:** upload PNG, JPEG, WebP or PDF flyers, provide a public URL, or enter a flyer manually. AI extraction creates only proposed rows with visible confidence/evidence; every sale can be corrected, accepted or rejected. Multi-buy totals are compared against regular prices on a per-item basis. A genuinely inconsistent comparison field is cleared, flagged and kept below bulk-accept confidence so one suspect row cannot discard the rest of a flyer.
- **Verified sale activation:** a flyer cannot be committed until no proposal remains and at least one sale is accepted. Only accepted rows from committed flyers whose dates overlap the requested plan are supplied to the selected weekly planner.
- **Ranked sale opportunities:** active sales are scored before the 150-row context cap using explicit household priority, advertised savings, preference and inventory fit, recent-meal novelty, available flavour assets, expiry and multi-buy practicality. A household can prioritize an accepted sale for the next planning run.
- **Sale-aware shopping:** generated and deterministically restored shopping lines retain the exact sale ID, store and advertised total price. The validator rejects unknown, expired or ingredient-mismatched sale claims and warns about mismatched stores or prices. Committed shopping notes preserve dates, multi-buy, membership and limit conditions.
- **Expired-sale cleanup:** archive every expired flyer and its inactive sale rows in one confirmed, audited action without deleting its evidence or history.

- **Full-week planner:** choose the first/final dates and meal boundaries, add exceptions or sale notes in any language, then select recommended Balanced Terra/medium planning or explicit Deep Sol planning.
- **Bounded, completion-safe planning:** Balanced responses have a 32,000-token ceiling and Deep responses have a 48,000-token ceiling because the Responses API counts reasoning and Structured Output together. The model-owned schema omits deterministic shopping, inventory allocation and scorecard fields, while concise field budgets prevent duplicated prose. The limits are ceilings, not preallocated usage; Balanced never silently escalates to Sol, and Deep may continue once with Terra only after a Sol timeout.
- **Durable background jobs:** leave or refresh the Meal Plan page while planning continues. Queued, normalizing, context-loading, planning, validating, completed and failed states remain visible.
- **Job controls:** cancel a queued or running full-week job, retry or dismiss a failed or cancelled job, and inspect elapsed time, current stage, model/search activity and errors. Dismissal hides the Planner card while preserving AI usage and diagnostics; retrying automatically dismisses the superseded attempt. A cancelled provider response is prevented from creating a late draft.
- **Household-aware planning:** the bounded planning context includes active inventory, a compact flavour-asset list, person-specific preferences, recent feedback, eight weeks of breakfast/lunch/dinner history, existing calendar meals, Unscheduled items, active shopping and the recipe library.
- **Preparation bases:** every new non-leftover meal is classified as a saved recipe, verified recipe, guided method, assembly or prepared food. It carries complete ingredient requirements plus a concise cookable method when a full recipe is unnecessary; leftovers retain an explicit source meal.
- **Visible planning scorecard:** each draft reports ranked and prioritized sales considered, sale-linked meals, use-now/use-soon inventory coverage, recent repeats, cuisines, techniques, primary ingredients and discovery versus familiar meals.
- **Direct-use freezer and fridge meals:** a conservative local classifier marks credible prepared foods as either complete meals or main components before the planning call. The planner can reheat or cook them as stored, add only a useful side or sauce, omit recipe links, and record their exact inventory consumption. Inventory notes are included for package or household preparation guidance; ordinary frozen ingredients are not reclassified.
- **Visible preferences:** add, edit, filter and supersede household or person-specific planning rules in **Preferences**. Contextual rules such as a member's packed-work-lunch restrictions remain scoped to work, while meal-size preferences shape that person's whole day.
- **Live recipe discovery:** an enabled-by-default request option lets the planner find established recipe sources, records only sources actually used by meals, and shows the verified publisher beside each matched link.
- **Evidence-based verification:** web-search calls and source counts are recorded with the AI run. The app never treats a guessed URL or unsupported popularity/rating claim as verified.
- **Source controls:** prefer or block publishers, prefer saved recipes, and control video-first, paywalled and registration-required sources in Settings. Blocked domains are enforced again when a suggestion is applied or rechecked.
- **Selective refinement:** regenerate one meal, a person-specific meal or a full day while preserving protected assignments and unrelated shopping/prep links. GPT-5.4 is the default; an explicit advanced checkbox uses Terra. Model-authored replacement shopping is discarded and rebuilt from the replacement meal's complete requirements.
- **Alternatives and ingredient-aware link repair:** request three evidence-backed meal replacements with deterministic shopping and leftover impact. Verified-link candidates show their complete sourced ingredient list and a server-calculated shopping preview before the explicit attach action. Saved household recipes can also be attached, and bad links can be removed or kept with a warning.
- **Recipe checks:** compare the planned dish with the exact source page and report supported preparation time, yield, accessibility and match status without inventing ratings.
- **Deterministic checks:** block missing meal coverage, invalid household/inventory references, unsafe workplace meals, over-two-hour weekday dinners, overlapping assignments and impossible leftover allocations; unavailable-inventory errors identify the exact stale item and quantity.
- **Complete automatic shopping:** after generation and every explicit edit, refinement or restore, all non-optional ingredient requirements and explicit inventory use are reconciled against inventory, active shopping and the draft. Compatible quantities are converted across `kg`/`g`, `lb`/`oz`, `L`/`ml` and `dozen`/`each`; only the true remainder becomes shopping. A recorded container that cannot be safely converted to a recipe measure is linked to the meal and shown as a confirmation warning instead of being called zero inventory. Bags, bunches and other countable shortages still round up.
- **Review and revisions:** inspect the plan by day, edit meals and shopping, save immutable revisions with human-readable summaries and structured change details, restore any previous version as a new revision, or reject the draft.
- **Reliable calendar status changes:** marking a committed meal Completed, Changed, Deferred or Skipped validates only the submitted change. Existing generated notes and rationale remain intact, and the normal day-archival and deferred-item workflow still runs in the same audited transaction.
- **Proposal and committed-plan lifecycle:** archive draft, rejected or superseded attempts directly from the Planner. Active committed plans cannot be manually archived, but their Planner card retires automatically once every linked calendar day has archived. Revisions, shopping provenance and audit evidence remain stored.
- **Meal-day inventory review:** when the final Planned entry on a day is resolved, Kitchen Planner archives the day and opens a review of the inventory amounts its committed meals expected to use, including exact unambiguous items registered from that plan's shopping. Every line can be selected, deselected or edited before subtraction; the review can also be skipped, and depleted items can be re-added to shopping.
- **Atomic approval:** commit reviewed meals, prep tasks and shopping in one database transaction. Linked Unscheduled intentions are consumed, while existing breakfast, lunch and dinner conflicts require a separate replacement checkbox. Multiple prep, snack and dessert entries may coexist on one day.
- **Truthful coverage:** explicit person absences or meals elsewhere are represented as no-meal exceptions instead of invented dishes.

- **Quick household update:** describe inventory and shopping changes naturally, review each proposed action, select only the correct ones, then approve or reject the proposal.
- **Feedback learner:** turn free-form reactions into separate per-person meal-feedback records and cautiously scoped, reusable preference suggestions.
- **Grocery registration helper:** recommend categories, storage locations and safe existing-inventory matches for purchased shopping items before the normal grocery-registration commit. A purchased item's linked archived entry remains a valid, visibly labelled restoration target; unknown optional IDs are removed without discarding the rest of the recommendation.
- **AI operations:** persist jobs, runs, prompt versions, model names, token usage, estimated cost, failures and seven-day proposals. Incomplete Structured Outputs retain their response ID and usage—including reasoning-token detail in the error—so an expensive failed attempt is not omitted from run history.
- **Usage controls:** show connection state, configured model aliases, rolling 30-day totals and expandable details for the latest 20 AI runs in Settings without exposing the API key.
- **Docker storage guard:** wait for a healthy replacement before removing the exact prior Kitchen Planner image, prune only unused build cache older than 24 hours, and cap each container's JSON logs at three 10 MB files.
- **Manual safe cleanup:** `./unraid.sh cleanup` reports Docker usage, removes dangling images and unused build cache, then reports reclaimed space. It never invokes broad system or volume pruning.

Every free-text update first receives a small GPT-5.4 mini normalization pass. Non-English statements are translated faithfully, and only normalized English enters matching and proposal generation; all proposal fields are requested in English. Simple updates and small grocery batches use GPT-5.4 mini, nuanced work and targeted plan refinements use GPT-5.4, and an explicit advanced refinement invokes GPT-5.6 Terra. Full-week generation defaults to GPT-5.6 Terra at medium reasoning; GPT-5.6 Sol is used only when **Deep** is selected. Web search is reserved for full planning when enabled, alternatives and recipe verification. Compact local retrieval and concise-output instructions keep context and responses bounded, while each call records model, tier, tokens and a retail-cost estimate.

Disable **Find and verify live recipe links** on an individual request to plan exclusively from saved household recipe links. Web discovery remains part of the premium planning call; routine updates never invoke it.

## Safety boundary

- The API key is server-side only and is never rendered into the browser.
- Model responses must satisfy strict Structured Output schemas and are checked again against current household IDs.
- Inventory, shopping and feedback changes use narrow service functions in a single PostgreSQL transaction.
- Ambiguous or destructive updates require a visible proposal and explicit approval.
- Rejection changes no household data. Selected approval applies only the checked actions.
- Every approved domain mutation records `source=ai` in the normal audit history.
- OpenAI Responses are requested with storage disabled; a one-way, household-scoped safety identifier is sent instead of a household ID.

## Upgrade from 0.5.x

Extract the release over the existing source directory while preserving `.env`. Add an OpenAI project API key directly on the Unraid server if you want the AI workflows enabled:

```bash
cd /mnt/user/appdata/kitchen-planner/source
nano .env
```

Add or update:

```dotenv
OPENAI_API_KEY=your-project-api-key
OPENAI_ECONOMY_MODEL=gpt-5.4-mini
OPENAI_ROUTINE_MODEL=gpt-5.4
OPENAI_FALLBACK_MODEL=gpt-5.6-terra
OPENAI_RECONCILIATION_MODEL=gpt-5.4
OPENAI_PLANNING_MODEL=gpt-5.6-sol
OPENAI_PLANNING_REASONING_EFFORT=high
OPENAI_PLANNING_TIMEOUT_MS=1800000
```

Then install the release:

```bash
chmod +x unraid.sh
./unraid.sh update
./unraid.sh status
```

`update` creates a PostgreSQL backup, builds the image and applies append-only migrations through `0016_multibuy_flyer_price_integrity.sql`. It preserves inventory, existing recipes, meal plans, shopping data, feedback, preferences, audit history and the completed workbook cutover. Existing queued weekly jobs remain Deep so an upgrade cannot silently change their selected model; newly queued plans default to Balanced. The updater waits for the new app to become healthy before reclaiming the previous Kitchen Planner image. Flyer files persist beneath the existing uploads volume. Do not rerun cutover.

The app still works normally when `OPENAI_API_KEY` is empty; AI controls show **Setup required** and all manual workflows remain available.

## Fresh installation

See [docs/UNRAID_7_1_2.md](docs/UNRAID_7_1_2.md). The application uses direct Docker commands through `unraid.sh`; Docker Compose is optional.

## Validation

```bash
npm run typecheck
npm run test:run
npm run build
npm run verify:runner
npm run verify:runtime
bash -n unraid.sh
```

See [docs/AI_WORKFLOWS.md](docs/AI_WORKFLOWS.md) for routing, safety and cost accounting, and [docs/DATA_MODEL.md](docs/DATA_MODEL.md) for persisted entities.
