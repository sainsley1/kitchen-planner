# Phase 4: reconciliation and real-data cutover

> Historical 0.4 boundary. Version 0.5.0 adds the proposal-only AI layer described in `AI_WORKFLOWS.md`; the guarded workbook cutover remains unchanged.

## Included

- Weekly Unscheduled items with create, status, assignment and removal workflows.
- Workbook normalization into typed destination payloads.
- Source sheet, one-based row, raw cells, warnings and normalized values retained in staging.
- Duplicate checks against the workbook and current database.
- Owner-only decisions for every row requiring reconciliation.
- Backup-gated, single-transaction cutover from the staged workbook.
- Before/after counts, per-action counts, imported entity links and an audit event.
- Automatic disabling of `DEMO_MODE` and `SEED_SYNTHETIC_DATA` after a successful cutover.

## Reconciliation choices

| Choice                        | Effect                                                                      |
| ----------------------------- | --------------------------------------------------------------------------- |
| Import as new                 | Validates edited normalized fields and creates a production record.         |
| Import into Unscheduled items | Keeps a this-week item without inventing an exact date.                     |
| Skip                          | Records the decision and creates no production record.                      |
| Use existing                  | Maps the source row to a detected non-synthetic record without changing it. |
| Replace existing              | Validates the edited payload and updates the selected detected record.      |

Starter fixtures cannot be selected as canonical existing records. They are removed inside the cutover transaction.

## Safety properties

- Staging does not mutate production household records.
- Only the household owner can stage or resolve a workbook.
- The cutover refuses committed batches and any batch with unresolved rows.
- The host creates and checksums a PostgreSQL backup before invoking the commit.
- All rows commit or all rows roll back.
- A unique audited cutover exists per batch.
- The app never receives the Docker socket.
- AI remains disabled.

## Workbook behavior

The four current meal-plan rows without exact dates—mango-coconut burfi, chocolate-chip cookie bars, mango lassi, and homemade hummus—are suggested as Unscheduled items. Unknown inventory quantities remain unavailable until explicitly quantified.
