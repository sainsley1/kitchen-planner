# Kitchen Planner engineering rules

- PostgreSQL is the only future production source of truth.
- Synthetic fixtures are allowed only before the guarded 0.4 cutover; the cutover removes known fixtures and disables future fixture seeding.
- Do not commit workbooks, API keys, passwords, uploads, or database dumps.
- All mutations must pass through a validated service function and create an audit event.
- AI tools may request service functions; they may never execute arbitrary SQL.
- Ambiguous or destructive changes require a preview and explicit confirmation.
- Keep database migrations append-only after a release is deployed.
- Run `npm run format:check`, `npm run typecheck`, `npm run test:run`, and `npm run build` before handoff.
- Preserve LAN-only deployment defaults until the user requests a wider access policy.
- Read `docs/MAINTAINER_GUIDE.md` selectively for architecture, change-to-file mapping, validation tiers, and release workflow.
