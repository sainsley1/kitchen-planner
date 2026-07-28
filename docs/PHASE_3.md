# Phase 3 release boundary

> Historical 0.3 boundary. Version 0.5.0 adds the proposal-only AI layer described in `AI_WORKFLOWS.md` without changing these persistence guarantees.

## Included

- Database-backed inventory CRUD, explicit consumption and archival.
- Persistent shopping status and removal.
- Persistent meal-plan entries and status changes.
- Per-person meal feedback.
- Revocable, HTTP-only, same-site LAN sessions using scrypt-hashed PINs.
- Household-scoped queries and mutations.
- Audit events for household-data changes, workbook previews and PIN resets.
- Macro-free `.xlsx` staging previews with row-level validity, warning and rejection states.
- PostgreSQL custom-format backups, checksums and guarded restore.

## Safety decisions

- Workbook previews are always marked `dry_run=true`.
- No API or interface commits an import batch.
- Unknown quantities are warnings and are not treated as available.
- Inventory removal archives rather than erasing the record.
- Shopping purchase does not automatically add inventory.
- AI remains disabled and cannot mutate the database.
- LAN HTTP sessions set `HttpOnly` and `SameSite=Strict`; `Secure` remains off until HTTPS is introduced.

## Deferred until approved cutover

- Real workbook commit and final reconciliation.
- PostgreSQL becoming the canonical household record.
- Natural-language mutation execution.
- AI model routing and meal-plan generation.
- Remote access, HTTPS and Tailscale exposure.
