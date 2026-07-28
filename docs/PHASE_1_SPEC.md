# Phase 1 technical specification

## Purpose

Kitchen Planner will replace the household Excel workbook as the operational source of truth only after a validated staging import and explicit cutover. Until then, the workbook remains authoritative and this application uses synthetic records.

## Target environment

- Unraid OS 7.1.2
- Docker Compose Manager or console-driven `docker compose`
- LAN-only access by IP and published port
- PostgreSQL database isolated on a private Docker network
- Persistent application data under a configurable Unraid appdata root

The supplied appdata value `/user/mnt/appdata` was treated as a likely path transposition. The deployment default is `/mnt/user/appdata`, but it is controlled entirely by `APPDATA_ROOT` in `.env` and must be verified on the server before launch.

## Architecture decisions

1. **One application container.** Next.js serves the responsive interface and server-side API.
2. **One database container.** PostgreSQL will become canonical after cutover.
3. **No browser database access.** The browser talks only to validated application endpoints.
4. **No AI-written SQL.** Future AI calls can invoke narrow service functions with schema-validated arguments.
5. **Audit every mutation.** Actor, source, reason, before/after state and idempotency key are recorded.
6. **Append-only migrations.** Deployed migration files are never rewritten.
7. **Workbook imports are batches.** Every imported row retains source sheet, source row, raw payload and validation outcome.
8. **Generated calendar views are derived.** Meal-plan entries are authoritative; calendar cards are presentation.

## Access and authentication

Phase 2 runs in `AUTH_MODE=disabled` only because it contains synthetic data and is LAN-only. Importing real household data is blocked until household authentication is implemented and enabled. The database is never published to the LAN.

## Application modules

- Dashboard: today, use-soon items, next packed lunch and week summary
- Inventory: searchable stock records and locations
- Meal plan: week calendar, leftovers and status
- Shopping: active/purchased workflow
- Feedback: per-person dish results and repeat decisions
- Settings: health, version, migration readiness and security state

## API boundary

Future mutation endpoints use a two-step contract:

1. `preview`: validate and return proposed changes, warnings and affected records.
2. `commit`: apply an unchanged preview token and write the audit event.

Destructive, bulk or ambiguous updates always require confirmation. Direct structured UI actions may skip AI, but they still use the same service layer and audit contract.

## AI routing boundary

- Tier 0: forms and buttons; no model
- Tier 1: routine language-to-operation parsing
- Tier 2: ambiguity resolution and reconciliation
- Tier 3: full weekly meal planning

Model names are environment variables. The OpenAI key remains server-side. Phase 2 contains contracts and configuration only; it makes no model calls.

## Phase 2 acceptance criteria

- Production build passes.
- Synthetic-data tests pass.
- PostgreSQL schema can be applied repeatedly without duplication.
- Application and database have health checks.
- Compose publishes only the application port.
- No workbook or household records are included.
- Settings make demo/auth state obvious.
