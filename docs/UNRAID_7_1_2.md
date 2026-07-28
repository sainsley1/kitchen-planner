# Unraid 7.1.2 deployment

Kitchen Planner uses ordinary Docker commands through `unraid.sh`; Docker Compose is not required.

## Storage

Verify the normal Unraid path before deploying:

```bash
ls -ld /mnt/user/appdata
```

The persistent paths are:

```text
/mnt/user/appdata/kitchen-planner/postgres
/mnt/user/appdata/kitchen-planner/uploads
/mnt/user/appdata/kitchen-planner/backups
```

## Fresh installation

Extract the release directly into the source directory, then configure it:

```bash
mkdir -p /mnt/user/appdata/kitchen-planner/source
cd /mnt/user/appdata/kitchen-planner/source
unzip /tmp/Kitchen_Planner_0.6.5.1.zip
cp .env.example .env
nano .env
chmod +x unraid.sh
./unraid.sh install
```

Set long hexadecimal values for `POSTGRES_PASSWORD` and `HOUSEHOLD_SESSION_SECRET`. Choose initial numeric PINs for the configured household members. Add an OpenAI project API key to `OPENAI_API_KEY` if AI workflows should be enabled; the key remains server-side and must never be pasted into the web interface. Keep `DEMO_MODE=true` and `SEED_SYNTHETIC_DATA=true` until the guarded workbook cutover succeeds.

Open `http://<unraid-ip>:8790`.

## Upgrade to 0.6.5.1

1. Run `./unraid.sh backup` in the current source directory.
2. If `docker.img` is currently full, reclaim unused build data before attempting another build:

```bash
docker image prune -f
docker builder prune -f
docker system df
```

3. Extract the 0.6.5.1 ZIP over the source directory. It contains `.env.example`, not `.env`, so existing secrets are preserved.
4. No `.env` change is required. Add `OPENAI_API_KEY` and model overrides only if they are not already configured.
5. Run:

```bash
chmod +x unraid.sh
./unraid.sh update
./unraid.sh status
```

The update applies append-only migrations through `0016_multibuy_flyer_price_integrity.sql`; 0.6.5.1 requires no new database migration. It preserves reviewed shopping exclusions and explicit inventory associations during validation, keeps valid structured leftover links, treats partial household coverage as a warning, and reconciles regenerated prep tasks without duplication. AI job/run diagnostics, token usage and errors remain stored. Runtime-data ignore rules are root-anchored so the `lib/db` application source is included in Git while root runtime data remains excluded. The updater keeps the Settings, package, Compose and installer version values aligned, waits for the replacement Kitchen Planner container to report healthy, removes the exact superseded Kitchen Planner image, and prunes only unused Docker build cache older than 24 hours. The previous image is retained when health validation fails. Existing household members, PIN hashes, inventory, preferences, recipes, flyers, drafts, committed meals, shopping, feedback and audit history are preserved; no workbook cutover is required.

## Upgrade from 0.4.0 or 0.3.0

1. Run `./unraid.sh backup` in the current source directory.
2. Extract the 0.6.5.1 ZIP over the source directory. It contains `.env.example`, not `.env`, so existing secrets are preserved.
3. Run:

```bash
chmod +x unraid.sh
./unraid.sh update
```

`update` creates another database backup, builds the image, recreates the two containers, applies append-only migrations and updates `APP_VERSION` without changing secrets. Existing PostgreSQL files remain mounted in place.

If the 0.4.0 cutover failed while loading `zod`, the failure occurred before the database transaction opened. Do not restore the database. Install 0.5.0 and rerun the same `cutover` command after `status` reports both containers healthy.

When upgrading from 0.4.3 after a successful cutover, do not run cutover again. The `0003` migration adds meal-day archival metadata, returns deferred entries from already-resolved days to Unscheduled items, and leaves canonical inventory and shopping data in place.

The default household time zone is `America/Vancouver`. An owner can change the live household timezone from **Settings**; meal dates, date defaults, dashboard meals and displayed audit times then use that database-backed setting.

## Health and logs

```bash
./unraid.sh status
./unraid.sh logs app
./unraid.sh logs db
curl http://127.0.0.1:8790/api/health
```

The health response includes `aiConfigured` but never returns the API key. The Settings page reports 30-day AI token and estimated-cost totals plus expandable details for the latest 20 runs.

## Docker storage maintenance

Both Kitchen Planner containers use bounded JSON logs: 10 MB per file and three files per container. A successful install or update removes the superseded Kitchen Planner image and prunes unused build cache older than 24 hours.

For a manual cleanup at any time:

```bash
cd /mnt/user/appdata/kitchen-planner/source
./unraid.sh cleanup
```

This reports usage before and after removing dangling images and unused build cache. It does not remove containers, tagged images or volumes. Do not substitute `docker system prune -a --volumes`; that has a materially broader deletion scope.

## Backups and PINs

```bash
./unraid.sh backup
./unraid.sh set-pin "Owner"
./unraid.sh set-pin "Member"
```

Backups and SHA-256 sidecars are written beneath `/mnt/user/appdata/kitchen-planner/backups`.

Restore is deliberately guarded and creates a new pre-restore backup:

```bash
./unraid.sh restore /mnt/user/appdata/kitchen-planner/backups/kitchen-planner-YYYYMMDD-HHMMSS.dump RESTORE
```

## Workbook reconciliation and cutover

1. Open **Settings & cutover → Workbook import** as the household owner.
2. Stage the latest canonical `.xlsx` file. The 5 MB upload limit and macro rejection remain in force.
3. Open the batch and choose what to do with every warning, rejected row or possible duplicate. You may edit normalized fields before importing.
4. When all decisions are resolved, copy the command displayed by the app and run it from the source directory:

```bash
./unraid.sh cutover BATCH_ID COMMIT
```

The command creates a checksummed backup, runs the import in one transaction, removes only known starter fixtures, switches `.env` out of demo/seeding mode and restarts the app. It prints an exact `rollback-cutover` command that restores the pre-cutover database and staging flags together.

Do not edit the workbook after staging the final batch. If it changes, stage the newer file and reconcile that new batch instead.
