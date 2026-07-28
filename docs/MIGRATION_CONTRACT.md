# Workbook migration contract

The workbook is not bundled with the app. Version 0.4 reads an explicitly supplied cutover copy and writes only to staging until every required reconciliation decision is saved and the host-side guarded cutover is invoked.

## Mapping

| Workbook sheet                    | Destination                                      |
| --------------------------------- | ------------------------------------------------ |
| Current Inventory                 | `inventory_entries`, `storage_locations`         |
| Food Profile                      | `food_preferences`                               |
| Meal Feedback                     | `recipes`, `meal_feedback`                       |
| Staples                           | `staple_targets`                                 |
| Shopping List                     | `shopping_items`                                 |
| Meal Plan Data with exact date    | `meal_plan_entries`, `recipes`                   |
| Meal Plan Data without exact date | `unscheduled_items`, `recipes`                   |
| Weekly Calendar                   | Derived view; not separately imported            |
| Reference Lists                   | Seed/reference values                            |
| Start Here                        | Household settings and operational documentation |

## Staging requirements

- Report source rows, accepted rows, warnings and rejected rows by sheet.
- Preserve source sheet, one-based row number and raw cell payload.
- Normalize whitespace and dates without changing the original payload.
- Detect duplicates using normalized item, brand, location and storage detail.
- Require an owner decision for conflicting units, missing quantities, unknown reference values, missing required values, and possible duplicates.
- Perform no partial production import.

Counts are always recomputed from the selected workbook. No household row count is embedded in the application.

## Cutover

1. Freeze workbook edits and stage the final copy.
2. Review every row requiring reconciliation and choose import, unscheduled, skip, use existing, or replace existing as applicable.
3. Create a fresh PostgreSQL backup.
4. Revalidate every staged payload and commit all rows in one transaction.
5. Record before/after counts, source coordinates, entity ids, decisions and the backup reference.
6. Mark PostgreSQL canonical and disable synthetic-data seeding.
7. Retain the workbook as a read-only snapshot.
