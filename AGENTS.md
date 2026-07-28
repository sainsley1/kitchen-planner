# Kitchen Planner engineering and release rules

- PostgreSQL is the only future production source of truth.
- Synthetic fixtures are allowed only before the guarded 0.4 cutover; the cutover removes known fixtures and disables future fixture seeding.
- Do not commit workbooks, API keys, passwords, uploads, database dumps, runtime data, backups, `node_modules`, or generated output.
- All mutations must pass through a validated service function and create an audit event.
- AI tools may request service functions; they may never execute arbitrary SQL.
- Ambiguous or destructive changes require a preview and explicit confirmation.
- Keep database migrations append-only after a release is deployed.
- Preserve LAN-only deployment defaults until the user requests a wider access policy.
- Treat maintenance releases as non-behavioral unless the task explicitly says otherwise: do not change application behavior, database schemas, environment-variable requirements, or production dependencies.
- Use repository-pinned development tools and lockfiles. Do not substitute a floating or globally installed formatter, linter, compiler, or test runner.
- Keep active version sources and displays aligned across `package.json`, `package-lock.json`, `lib/config.ts`, `compose.yml`, `.env.example`, `unraid.sh`, and current documentation. Do not rewrite historical release notes.
- Preserve the established CI workflow and intentional mechanical formatting baseline unless the task explicitly changes them.
- Before handoff, run `npm ci`, `npm run format:check`, `npm run typecheck`, `npm run test:run`, `npx vitest run tests/release-version.test.ts`, `npm run build`, `npm run verify:runtime`, and `npm run verify:runner`.
- Review the complete diff before publication and exclude unrelated changes, secrets, workbooks, uploads, database dumps, runtime data, backups, `node_modules`, and generated files.
- Push release changes to their intended pull-request branch, wait for the complete GitHub Actions workflow, and never merge without explicit authorization.
- Read `docs/MAINTAINER_GUIDE.md` selectively for architecture, change-to-file mapping, validation tiers, and release workflow.
