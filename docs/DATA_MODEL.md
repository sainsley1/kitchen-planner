# Data model

## Core ownership

All household records carry `household_id`. Person-specific records also carry `user_id`. This prevents future assumptions that a dish preference or meal assignment applies equally to everyone.

## Main entities

| Entity                       | Purpose                                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `households`                 | Household identity and timezone                                                                                                                                                              |
| `household_users`            | Individual household profiles, roles and scrypt-hashed PINs                                                                                                                                  |
| `app_sessions`               | Opaque, revocable login sessions; only token hashes are stored                                                                                                                               |
| `storage_locations`          | Fridge, freezer, pantry and detailed shelf hierarchy                                                                                                                                         |
| `inventory_entries`          | Quantity, unit, location, stock state, priority and notes                                                                                                                                    |
| `recipes`                    | Household/external recipe source, structured ingredients and instructions, cuisine, yield, timing, planning suitability, favourite/status lifecycle and archival state                       |
| `flyer_sources`              | Store, location, validity window, retained file/URL metadata, extraction warnings and review/commit lifecycle                                                                                |
| `flyer_sale_items`           | Proposed/accepted/rejected advertised item, category, sale/regular price, supported savings, unit, multi-buy/member/limit conditions, planning priority, confidence and visible evidence     |
| `food_preferences`           | Person/household preferences, constraints and lifecycle status                                                                                                                               |
| `meal_plan_entries`          | Date, meal, person, dish, recipe, packed-lunch flag, status, automatic day-archive state, originating weekly-plan meal and expected inventory uses                                           |
| `meal_day_inventory_reviews` | Pending/applied/dismissed review of expected inventory consumption after an entire meal day archives, including the household's edited resolution                                            |
| `unscheduled_items`          | Week-level cooking intent without an invented day or meal slot, including deferred meals returned from archived days                                                                         |
| `meal_feedback`              | One person/dish outcome with changes and repeat decision                                                                                                                                     |
| `shopping_items`             | Purchase workflow plus optional inventory and originating weekly-plan links                                                                                                                  |
| `staple_targets`             | Minimum stock and reorder rule                                                                                                                                                               |
| `audit_events`               | Before/after mutation history                                                                                                                                                                |
| `import_batches`             | Workbook import execution and reconciliation totals                                                                                                                                          |
| `import_rows`                | Raw source row, typed destination payload, duplicate candidates, user decision and committed entity link                                                                                     |
| `cutover_runs`               | Backup reference, before/after counts and one transactional cutover outcome                                                                                                                  |
| `app_settings`               | Household-scoped configuration                                                                                                                                                               |
| `ai_jobs`                    | Household-scoped workflow request, lifecycle, input summary, fallback eligibility and optional original-job link                                                                             |
| `ai_runs`                    | Provider/model, economy, primary, fallback or planning tier, trigger reason, prompt version, response ID, token usage, web-search/source counts, cost estimate, latency and failure metadata |
| `ai_proposals`               | Structured proposed actions, selected approvals, result links and decision lifecycle                                                                                                         |
| `weekly_plans`               | Premium planning boundaries, structured preparation/ingredient payload, deterministic sale/variety scorecard, validation issues, lifecycle, commit attribution and soft-archive state        |
| `weekly_plan_revisions`      | Immutable AI, UI-edit, refinement, alternative, recipe-link and restored snapshots with summaries and structured change details                                                              |
| `weekly_plan_recipe_sources` | Exact live recipe URLs used by a weekly draft and matched to returned web evidence, with title, domain and verification time                                                                 |
| `weekly_plan_suggestions`    | Expiring, reviewable meal-alternative and recipe-link option sets, including application status and selected option                                                                          |

## Quantity model

Inventory quantities use `numeric(12,3)` plus a controlled unit string. This preserves fractional pounds, litres and approximate counts without floating-point rounding. Unknown quantities remain null and are not treated as available stock.

## History rules

- Inventory rows can be archived but are not silently deleted.
- Meal-plan days are archived when no active entry remains Planned; deferred entries are returned to Unscheduled items first.
- Archiving a committed-plan day creates a reviewable inventory-use proposal from the exact uses recorded at commit. Inventory changes occur only after the household applies edited selections; dismissed reviews preserve inventory.
- Draft, rejected and superseded weekly-plan proposals can be soft-archived. An active committed plan cannot be manually archived, but it automatically leaves normal Planner listings after all linked meal entries are archived; its provenance remains stored.
- Food preferences retain active, contextual and superseded states.
- Imported source metadata remains available after normalization.
- Audit events are append-only.
- AI proposals expire for approval after seven days; an expired proposal is shown as historical context and cannot be committed.
- AI run metadata is retained with the household database so model usage and failures can be reviewed independently of domain records.
- Weekly-plan edits append revisions; restoring an old version appends another revision and preserves the complete review trail.
- Verified live recipe evidence is retained with its weekly plan; later manual URL edits do not silently inherit verification.
- Weekly-plan suggestions expire after seven days and become single-use when applied.
- Archived or `avoid` recipes are omitted from AI planning evidence.
- Flyer extraction is never active evidence: only accepted rows belonging to committed, non-archived flyers with overlapping validity dates reach weekly planning. Expired flyer bulk archival is a soft delete.
- Cancelling a full-week generation marks its durable job before aborting the provider request, preventing a late response from creating a draft.
- A weekly plan commits its meals and new shopping items in one transaction, with every created or replaced record written to normal audit history.
