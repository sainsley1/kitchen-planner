# AI workflows in 0.7.0

## Routing

| Tier                                  | Model setting                             | Use                                                                                                                                                                                  |
| ------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Economy                               | `OPENAI_ECONOMY_MODEL` (`gpt-5.4-mini`)   | English normalization, simple quick updates and grocery batches of eight items or fewer at low reasoning                                                                             |
| Primary                               | `OPENAI_ROUTINE_MODEL` (`gpt-5.4`)        | Nuanced feedback, complex or multi-item updates, larger grocery batches, targeted draft refinement, alternatives, source checks, recipe import and flyer extraction at low reasoning |
| Balanced planning / advanced fallback | `OPENAI_FALLBACK_MODEL` (`gpt-5.6-terra`) | Recommended full-week planning and explicit advanced refinements at medium reasoning                                                                                                 |
| Reconciliation                        | `OPENAI_RECONCILIATION_MODEL` (`gpt-5.4`) | Reserved for a later reconciliation workflow                                                                                                                                         |
| Deep planning                         | `OPENAI_PLANNING_MODEL` (`gpt-5.6-sol`)   | Explicit opt-in complete weekly-plan drafts at `OPENAI_PLANNING_REASONING_EFFORT`; never used automatically or for routine updates                                                   |

Calls use the OpenAI Responses API and strict Structured Outputs. Response storage is disabled. Model aliases remain environment variables so the household can change them without a database migration. Routine workflows never escalate automatically: the initial result remains available and the user decides whether to spend an advanced call. Weekly planning is queued locally, processed after the browser receives HTTP 202, and polled through a household-scoped status endpoint. **Balanced** is the default: Terra at medium reasoning with a 32,000-token response ceiling. It fails visibly instead of silently escalating to Sol. **Deep** is explicit: Sol at the configured effort with a 48,000-token ceiling. These ceilings include hidden reasoning, non-visible formatting and the final structured JSON; they do not preallocate or charge the full amount. If Deep Sol times out, the same durable job records that run as failed and may continue once with Terra at medium reasoning and the same extended 30-minute timeout. Live recipe discovery, when enabled, remains enabled for the continuation. Alternative generation, link discovery and source checking use web search because exact page evidence is required; ordinary household updates do not.

Targeted refinements, meal alternatives, and recipe-link discovery use compact generation-only contracts. Routine targeted calls start with a 24,000-token ceiling and advanced calls with 32,000. Only a genuine `max_output_tokens` truncation receives one automatic compact retry, at 32,000 or 48,000 tokens respectively. The original incomplete run remains recorded with its response ID and token usage, and no draft changes are applied unless the retry returns a complete validated response.

Official references: [model selection](https://developers.openai.com/api/docs/models), [Responses text generation](https://developers.openai.com/api/docs/guides/text), [reasoning-token allocation](https://developers.openai.com/api/docs/guides/reasoning), and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Execution lifecycle

1. Validate the HTTP request and authenticated household session.
2. For free text, run a bounded economy-tier language pass and store the detected language, original input and normalized English. Fallback retries reuse the stored normalization.
3. Load household-scoped records locally, then select a relevant context under hard record caps.
4. Insert an `ai_jobs` row and an `ai_runs` row with a versioned prompt identifier and economy, primary, balanced, fallback or planning tier. Full-week planning first persists the selected mode in a queued job and returns to the browser before model work starts.
5. Request a strict structured response with all user-facing fields constrained to English. Weekly planning optionally includes web search and returned source evidence. Its generation-only schema contains culinary decisions and complete ingredient requirements, but omits fields the application can calculate more reliably: `inventoryUses`, proposed shopping, `reviewScorecard`, and `planFormatVersion`.
6. Validate referenced household, inventory, shopping, storage, meal and recipe information against the supplied context. A live recipe URL is verified only by canonical match to returned web evidence.
7. Deterministically expand saved recipes, convert compatible inventory and shopping units, reconcile every required ingredient and genuine shortage into proposed shopping, calculate the plan scorecard, then store the reviewable proposal or weekly-plan draft.
8. Require explicit approval before model output changes household data.
9. Apply approved mutations in a database transaction and append normal `source=ai` audit events.

Warnings and household-validation failures make a routine economy or primary job eligible for an explicit advanced retry. A retry stores `retry_of_job_id`, uses the server-stored English normalization, and records its model tier and trigger reason. Failed or cancelled full-week jobs can be dismissed from the Planner without deleting their job/run diagnostics, token usage or audit history; retrying one automatically dismisses the superseded card.

## Workflow boundaries

### Quick household update

Supported proposed operations are quantity set/add/subtract, inventory move/create/archive, shopping-list add and shopping status. The model cannot name a table or SQL expression. Existing records must use IDs supplied in the reference context.

Depleting inventory to zero archives it. Adding the depleted item to shopping is a separate, visible property of that proposed action.

### Feedback learner

The output distinguishes one-time dish feedback from reusable learning. A failed technique or recipe is not automatically treated as a cuisine or ingredient dislike. Person attribution is retained, and every preference suggestion can be unchecked independently.

### Grocery registration

Recommendations populate the existing registration form; they do not register anything automatically. Existing inventory is suggested only when the product and unit appear compatible. If a purchased shopping item already points to an archived inventory entry, that exact record is included in the compact AI context and marked as an allowed restoration target. The registration form labels it as a previous entry, and normal registration restores it. The server still rejects unknown shopping-item ownership; invented optional inventory or location IDs are cleared for review instead of invalidating otherwise useful fields. Unit compatibility remains enforced by the normal registration service.

### Full-week planner

The planner accepts a one-to-ten-day window with explicit first and final meal boundaries. It receives capped, household-scoped snapshots of active users, inventory, a separate flavour-asset view of sauces/pastes/oils/aromatics/seasonings, preferences, feedback, the preceding 56 days of ordinary main meals, existing meals, Unscheduled items, shopping, up to 60 ranked active saved recipes and up to 150 ranked active sale opportunities. Per-recipe ingredients, tags, descriptions and notes are also capped; full instructions and inactive flyer history are intentionally omitted from planning context. Inventory notes are capped at 500 characters.

Before the sale cap is applied, every eligible accepted sale is scored using explicit household priority, supported discount evidence, preference and inventory overlap, recent-meal novelty, flavour-asset availability, expiry timing and multi-buy practicality. The planning prompt asks for two to four strong sale anchors when enough genuinely suitable opportunities exist, while allowing unsuitable or wasteful sales to be skipped. Unfamiliar produce is treated as a discovery opportunity: the planner must identify the exact item, inspect available flavour assets and, when discovery is enabled, find preparation evidence rather than produce an unsupported dish title.

Every format-v2 non-leftover meal returns a preparation basis (`saved_recipe`, `verified_recipe`, `guided_method`, `assembly` or `prepared_food`), technique, primary ingredients and complete required ingredients. Guided methods, assemblies and prepared foods also carry concise preparation instructions. A URL is optional when the method is independently cookable; a title alone is not enough. Leftovers use the `leftover` basis and retain an explicit earlier source meal; the server canonicalizes that structured relationship rather than inferring it from a display title. That leftover basis takes precedence when saved-recipe enrichment expands the meal's ingredients, while the recipe relationship and metadata remain attached. The server matches requirements to inventory, converts compatible mass, volume and count units, creates only genuine shopping shortfalls, preserves a chosen sale's exact store/price on matching automatic lines, and then calculates a deterministic review scorecard. A positive recorded container with no safe conversion to the recipe unit suppresses an automatic duplicate and creates a visible quantity-confirmation warning; unknown inventory quantities are still not treated as measured availability.

Before the call, a conservative local classifier identifies cold-stored prepared food that can serve as a complete meal or main component without a recipe. The model returns meals, explicit leftover links, complete requirements, prep tasks and a consolidated warning list, with concise-output instructions to avoid repeating rationale across fields. It does not return shopping, inventory allocation or the scorecard: the server reconstructs those from the meal requirements and current household state before validation. The model response may contain more warnings than requested without invalidating the otherwise complete plan; model and deterministic container-confirmation warnings are de-duplicated and bounded to the persisted 30-warning review contract, with an explicit summary when additional distinct warnings were condensed. One queued or running generation is allowed per household. The selected Balanced/Deep mode persists through cancellation retries and process restarts. Container startup requeues an interrupted generation while retaining the interrupted run as failed history.

Direct-use classification is intentionally narrow. Prepared pizza, pot pies, burritos, lasagna, recorded leftovers and similar foods can anchor a complete meal. Fritters, breaded or battered foods, dumplings, pierogies, samosas, kebabs, patties and similar items can anchor a meal with a simple side and optional sauce. Raw seafood or meat, frozen fruit and vegetables, pizza sauce, dough and other normal ingredients are not promoted to meals merely because they are refrigerated or frozen. The planner is instructed to follow package or household notes, use safe cooking guidance, avoid unnecessary recipe discovery, reference the exact inventory ID and shop only for genuinely missing accompaniments.

The server independently validates:

- at least one assigned meal in each requested breakfast/lunch/dinner slot, with incomplete household-member coverage reported as a non-blocking warning and explicit person-specific no-meal exceptions supported;
- valid dates and supplied household/inventory IDs;
- non-overlapping household/person assignments;
- workplace-friendly meals where `workplaceMeal` is true;
- the two-hour weekday-dinner limit;
- chronological leftover sources and sufficient reserved servings;
- complete ingredient requirements and preparation methods for format-v2 meals;
- shopping-to-meal references, uncovered ingredients and detectable inventory shortfalls;
- exact saved-recipe and active flyer-sale IDs, sale-to-ingredient consistency, plus flyer item/store/price consistency;
- existing Planned-meal conflicts, heavy days and excessive repetition.

A draft and immutable revision 1 are stored before anything reaches the calendar. UI edits create later immutable revisions, and restoring history creates another revision rather than overwriting history. An automatic shopping requirement can carry a persisted draft decision: a household member may explicitly exclude it or choose an exact current inventory record after a prefilled search. These decisions survive revalidation, never change inventory quantities, never fuzzy-link an item without confirmation, and can be undone so normal reconciliation runs again. The scorecard shows sale usage, priority-inventory coverage, recent repeats, cuisine/technique/primary-ingredient diversity and discovery-versus-familiar meals. Blocking issues disable commit. Final approval writes meals, expected inventory uses, reconciled prep tasks, recipe references and non-duplicate shopping items in one transaction, consumes explicitly linked Unscheduled items, and records `source=ai` audit events. Replacing existing Planned meals requires explicit approval.

Draft, rejected and superseded proposals may be archived from the Planner. Archival is an audited soft delete: the proposal is excluded from normal listing and cannot be edited or refined, while its revisions, model usage and source evidence remain stored. An active committed plan cannot be manually archived, but it is retired automatically from the Planner after its final linked meal day is archived; its revisions, model usage, recipe evidence and shopping provenance remain stored.

When a meal day has no remaining Planned entries, the existing automatic day archive now aggregates the inventory uses persisted from committed meals. Requirements not yet in inventory are retained by normalized item name and unit, allowing an exact unambiguous entry created during grocery registration to join the later review; ambiguous matches are omitted. A pending modal lets the household select lines and edit quantities before any subtraction. Applying the review uses the normal inventory-consumption service and audit trail; depleting a line can optionally restore it to shopping. Dismissing the review changes no inventory. These are UI-controlled domain mutations, not a second AI call.

With **Find and verify live recipe links** enabled, the planner can search selectively for strong recipe anchors from established publishers. It is instructed to prefer popular or highly rated recipes only when the available evidence supports that characterization and never to invent ratings or review counts. Returned links must be exact recipe-page HTTP(S) URLs from the search evidence or household library, not search pages, category pages or guessed URLs.

The server canonicalizes URLs, removes common tracking parameters and persists only evidence sources whose URLs match recipes actually used by the draft. Those links receive a **Source verified** marker and publisher domain in the review UI. An unmatched or manually edited URL is retained but receives an `unverified_recipe_url` warning. Disabling discovery sends no web-search tool and restricts links to the household recipe library.

### Draft refinement and alternatives

Only a draft can be refined. The household can target one meal, one person-specific meal or every meal on one date. Original assignment IDs, dates, meal types and assigned people are protected. Unselected meals remain unchanged; shared shopping, shopping-decision and prep records keep their links to unaffected meals. Obsolete selected-meal prep links are removed before replacement tasks are added, duplicate prep IDs are normalized before persistence, and repeated regeneration is idempotent. Structured leftover sources are retained whenever a replacement still declares itself as leftovers, and source meals keep enough reserved servings for unaffected downstream leftovers. The merged full plan then passes the same deterministic validator used for full-week generation.

Targeted refinement defaults to GPT-5.4 at low reasoning. The **Use advanced Terra retry** checkbox explicitly routes that one request to GPT-5.6 Terra at medium reasoning. Full-week Sol is never used for these local changes. User instructions receive the same GPT-5.4 mini English normalization pass used by other free-text workflows.

Meal alternatives return exactly three reviewable options. Each option includes its meal payload, server-calculated shopping impact, downstream-leftover impact and an exact recipe page backed by returned web evidence. Model-authored shopping is discarded. Choosing an option recalculates the shopping once more and creates a new immutable plan revision; it does not directly modify committed calendar meals.

Verified recipe-link candidates include the complete ingredient list supported by the selected page plus a visible shopping preview. After structured extraction, a deterministic pass discards the model's shopping comparison and checks each required, non-optional ingredient against inventory, active shopping and the draft's existing shopping using the same compatible-unit and container-ambiguity rules as full generation. The recipe URL and those reviewed shopping changes are merged only when the user selects **Attach recipe and shopping**.

Recipe-link repair can:

- check the current URL against the planned dish and report evidence-backed prep time or yield;
- find up to three exact verified replacements;
- attach a saved household recipe;
- remove the link; or
- deliberately retain an unverified link and its warning.

Preferred and blocked publishers, saved-recipe preference, and video/paywall/registration settings are stored per household. A blocked domain cannot be recorded as verified and is rechecked when a previously generated suggestion is applied.

### Recipe import and flyer extraction

Recipe import accepts pasted text, an exact public URL, or a PNG/JPEG/WebP/PDF attachment. Small text imports use the economy model; URL, long-text and file imports use the primary model. The structured result is shown in the recipe editor and requires an ordinary explicit save. The source is instructed not to invent missing quantities, times, yields or instructions.

Flyer extraction uses the primary model and accepts the same image/PDF formats or a public URL. Uploaded files are retained in the existing `/app/uploads` volume. Extracted rows remain `proposed`; confidence is informational and even the high-confidence bulk action is a user-triggered review decision. Supported category, regular price, savings and discount evidence are retained. Multi-buy totals are compared to visibly printed per-item regular prices on a per-item basis. Cross-field price integrity is normalized after Structured Output parsing: a genuinely inconsistent row has its unsafe comparison fields cleared, receives a specific warning and is forced below the bulk-accept threshold instead of causing the entire flyer to fail. A flyer becomes planning evidence only after every proposal is resolved and the flyer is explicitly committed. Accepted rows may be explicitly prioritized for planning. All expired flyer sources can be soft-archived in one confirmed action; sale rows and audit evidence remain stored. Manual flyer and sale entry work with no API key.

### Visible planning preferences

The **Preferences** page exposes planning evidence that was previously only visible in imported records. Each rule has a household/person owner, topic, classification, detail, optional context, effective date and active/contextual/superseded status. Current rules are supplied to full-week generation and targeted refinement.

Context is intentionally narrow. For example, a low-aroma packed-work-lunch rule affects weekday meals taken to work but does not become a general dinner ban. Meal-size and daily-balance rules can apply across the person's full day. Editing or superseding a rule creates a normal audit event, and superseded rules remain available as history but no longer guide planning.

### Job and revision controls

A queued or running full-week job can be cancelled. The database is marked first, the in-process request is aborted when possible, and a second active-state check prevents a late provider response from creating a draft. Failed and cancelled generations can be retried from their stored normalized request.

The Meal Plan page displays the current stage, elapsed time and terminal error. Each accepted AI refinement, alternative, recipe-link action, manual edit and restoration appends a revision with a human-readable summary plus structured change details. Suggestions expire after seven days and cannot be reused after application.

## Privacy and operational controls

- `OPENAI_API_KEY` is read only by the server process.
- The application sends an HMAC-derived safety identifier, not its household UUID.
- `store: false` is set on every response request.
- The app stores submitted text, proposal or plan, run metadata and token counts in its own PostgreSQL database for household history and troubleshooting. An incomplete response still contributes its response ID and token usage to the failed run instead of disappearing from usage accounting.
- Settings shows 30-day totals split by economy, primary, balanced, fallback and planning model. Expandable details for the latest 20 runs show model, tier, reasoning, input/cached-input/output/total tokens, estimated token cost, duration, web-search calls and failures. Estimated cost uses configurable model token rates before grants or credits and is not an invoice; web-search tool charges, if any, are not included in that token-only estimate.

Current defaults:

```dotenv
OPENAI_PLANNING_REASONING_EFFORT=high
OPENAI_PLANNING_TIMEOUT_MS=1800000
OPENAI_ECONOMY_INPUT_USD_PER_M=0.75
OPENAI_ECONOMY_CACHED_INPUT_USD_PER_M=0.075
OPENAI_ECONOMY_OUTPUT_USD_PER_M=4.5
OPENAI_ROUTINE_INPUT_USD_PER_M=2.5
OPENAI_ROUTINE_CACHED_INPUT_USD_PER_M=0.25
OPENAI_ROUTINE_OUTPUT_USD_PER_M=15
OPENAI_FALLBACK_INPUT_USD_PER_M=2.5
OPENAI_FALLBACK_CACHED_INPUT_USD_PER_M=0.25
OPENAI_FALLBACK_OUTPUT_USD_PER_M=15
OPENAI_PLANNING_INPUT_USD_PER_M=5
OPENAI_PLANNING_CACHED_INPUT_USD_PER_M=0.5
OPENAI_PLANNING_OUTPUT_USD_PER_M=30
```

Update these values if OpenAI pricing changes, then run `./unraid.sh update`.
