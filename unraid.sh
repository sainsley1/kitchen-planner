#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE="${ENV_FILE:-.env}"
APP_IMAGE="kitchen-planner:local"
APP_CONTAINER="kitchen-planner-app"
DB_CONTAINER="kitchen-planner-db"
NETWORK="kitchen-planner-internal"
APP_RELEASE_VERSION="0.7.0"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

load_config() {
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE does not exist. Run: cp .env.example .env"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  : "${APPDATA_ROOT:=/mnt/user/appdata}"
  : "${APP_PORT:=8790}"
  : "${POSTGRES_DB:=kitchen_planner}"
  : "${POSTGRES_USER:=kitchen_planner}"
  : "${APP_TIME_ZONE:=America/Vancouver}"
  [[ -n "${POSTGRES_PASSWORD:-}" ]] || die "POSTGRES_PASSWORD is empty in $ENV_FILE"
  [[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL is empty in $ENV_FILE"
}

migrate_release_config() {
  if [[ "${OPENAI_PLANNING_REASONING_EFFORT:-}" == "max" ]]; then
    echo "Changing weekly planning reasoning from max to high for asynchronous planning."
    set_env_value "OPENAI_PLANNING_REASONING_EFFORT" "high"
    OPENAI_PLANNING_REASONING_EFFORT="high"
  fi
  current_planning_timeout="${OPENAI_PLANNING_TIMEOUT_MS:-0}"
  if [[ ! "$current_planning_timeout" =~ ^[0-9]+$ ]] || (( current_planning_timeout < 1800000 )); then
    echo "Raising the weekly planning timeout to 30 minutes."
    set_env_value "OPENAI_PLANNING_TIMEOUT_MS" "1800000"
    OPENAI_PLANNING_TIMEOUT_MS="1800000"
  fi
}

ensure_storage() {
  [[ -d "$APPDATA_ROOT" ]] || die "APPDATA_ROOT does not exist: $APPDATA_ROOT"
  mkdir -p \
    "$APPDATA_ROOT/kitchen-planner/postgres" \
    "$APPDATA_ROOT/kitchen-planner/uploads" \
    "$APPDATA_ROOT/kitchen-planner/backups"
}

ensure_network() {
  docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
}

remove_containers() {
  docker rm -f "$APP_CONTAINER" "$DB_CONTAINER" >/dev/null 2>&1 || true
}

start_database() {
  docker pull postgres:17-alpine
  docker run -d \
    --name "$DB_CONTAINER" \
    --restart unless-stopped \
    --network "$NETWORK" \
    --network-alias db \
    -e "POSTGRES_DB=$POSTGRES_DB" \
    -e "POSTGRES_USER=$POSTGRES_USER" \
    -e "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
    -e "TZ=$APP_TIME_ZONE" \
    --log-driver json-file \
    --log-opt max-size=10m \
    --log-opt max-file=3 \
    -v "$APPDATA_ROOT/kitchen-planner/postgres:/var/lib/postgresql/data" \
    --health-cmd="pg_isready -U $POSTGRES_USER -d $POSTGRES_DB" \
    --health-interval=10s \
    --health-timeout=5s \
    --health-retries=10 \
    postgres:17-alpine >/dev/null
}

wait_for_database() {
  echo "Waiting for PostgreSQL..."
  for _ in $(seq 1 60); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' "$DB_CONTAINER" 2>/dev/null || true)"
    [[ "$status" == "healthy" ]] && return 0
    [[ "$status" == "unhealthy" ]] && {
      docker logs --tail=100 "$DB_CONTAINER" >&2
      die "PostgreSQL became unhealthy"
    }
    sleep 2
  done
  docker logs --tail=100 "$DB_CONTAINER" >&2
  die "Timed out waiting for PostgreSQL"
}

build_app() {
  docker build --pull -t "$APP_IMAGE" .
}

start_app() {
  docker run -d \
    --name "$APP_CONTAINER" \
    --restart unless-stopped \
    --network "$NETWORK" \
    --env-file "$ENV_FILE" \
    -e "APP_TIME_ZONE=$APP_TIME_ZONE" \
    -e "TZ=$APP_TIME_ZONE" \
    -e "PGTZ=$APP_TIME_ZONE" \
    --log-driver json-file \
    --log-opt max-size=10m \
    --log-opt max-file=3 \
    -p "$APP_PORT:3000" \
    -v "$APPDATA_ROOT/kitchen-planner/uploads:/app/uploads" \
    "$APP_IMAGE" >/dev/null
}

wait_for_app() {
  echo "Waiting for Kitchen Planner..."
  for _ in $(seq 1 60); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' "$APP_CONTAINER" 2>/dev/null || true)"
    [[ "$status" == "healthy" ]] && return 0
    [[ "$status" == "unhealthy" ]] && {
      docker logs --tail=100 "$APP_CONTAINER" >&2
      die "Kitchen Planner became unhealthy; the previous image has been retained"
    }
    sleep 2
  done
  docker logs --tail=100 "$APP_CONTAINER" >&2
  die "Timed out waiting for Kitchen Planner; the previous image has been retained"
}

cleanup_previous_app_image() {
  local previous_image="${1:-}"
  local current_image=""
  current_image="$(docker image inspect --format '{{.Id}}' "$APP_IMAGE" 2>/dev/null || true)"
  if [[ "$previous_image" =~ ^sha256:[0-9a-f]{64}$ && "$current_image" =~ ^sha256:[0-9a-f]{64}$ && "$previous_image" != "$current_image" ]]; then
    if docker image rm "$previous_image" >/dev/null 2>&1; then
      echo "Removed the superseded Kitchen Planner image."
    else
      echo "Previous Kitchen Planner image is still referenced and was retained."
    fi
  fi
}

prune_old_build_cache() {
  echo "Pruning unused Docker build cache older than 24 hours..."
  if ! docker builder prune --force --filter "until=24h"; then
    echo "WARNING: Docker build-cache cleanup failed; Kitchen Planner is already healthy." >&2
  fi
}

install_stack() {
  local previous_app_image=""
  previous_app_image="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER" 2>/dev/null || true)"
  load_config
  migrate_release_config
  set_env_value "APP_VERSION" "$APP_RELEASE_VERSION"
  ensure_storage
  ensure_network
  build_app
  remove_containers
  start_database
  wait_for_database
  start_app
  wait_for_app
  cleanup_previous_app_image "$previous_app_image"
  prune_old_build_cache
  echo
  echo "Kitchen Planner started on http://$(hostname -I | awk '{print $1}'):$APP_PORT"
  echo "Run './unraid.sh status' to check container health."
}

cleanup_docker_storage() {
  echo "Docker storage before cleanup:"
  docker system df
  echo
  echo "Removing dangling images..."
  docker image prune --force
  echo "Removing unused Docker build cache..."
  docker builder prune --force
  echo
  echo "Docker storage after cleanup:"
  docker system df
}

backup_stack() {
  load_config
  ensure_storage
  docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || die "$DB_CONTAINER does not exist"
  [[ "$(docker inspect --format '{{.State.Running}}' "$DB_CONTAINER")" == "true" ]] || die "$DB_CONTAINER is not running"
  timestamp="$(date +%Y%m%d-%H%M%S)"
  destination="$APPDATA_ROOT/kitchen-planner/backups/kitchen-planner-$timestamp.dump"
  temporary="$destination.partial"
  echo "Creating PostgreSQL backup..."
  if docker exec "$DB_CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$temporary"; then
    mv "$temporary" "$destination"
    sha256sum "$destination" > "$destination.sha256"
    LAST_BACKUP="$destination"
    echo "Backup created: $destination"
  else
    rm -f "$temporary"
    die "PostgreSQL backup failed"
  fi
}

set_env_value() {
  key="$1"
  value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

cutover_stack() {
  load_config
  batch_id="${2:-}"
  confirmation="${3:-}"
  [[ "$batch_id" =~ ^[0-9a-fA-F-]{36}$ ]] || die "Use the batch UUID shown on the reconciliation screen"
  [[ "$confirmation" == "COMMIT" ]] || die "Cutover requires explicit confirmation: ./unraid.sh cutover BATCH_ID COMMIT"
  docker inspect "$APP_CONTAINER" >/dev/null 2>&1 || die "$APP_CONTAINER does not exist"
  [[ "$(docker inspect --format '{{.State.Running}}' "$APP_CONTAINER")" == "true" ]] || die "$APP_CONTAINER is not running"

  backup_stack
  echo "Committing reconciled workbook batch in one database transaction..."
  docker exec \
    -e "CUTOVER_BACKUP_REFERENCE=$LAST_BACKUP" \
    "$APP_CONTAINER" node scripts/commit-import.mjs "$batch_id" COMMIT

  set_env_value "DEMO_MODE" "false"
  set_env_value "SEED_SYNTHETIC_DATA" "false"
  docker rm -f "$APP_CONTAINER" >/dev/null
  start_app
  echo
  echo "Cutover complete. PostgreSQL is now the canonical data source."
  echo "Rollback command: ./unraid.sh rollback-cutover $LAST_BACKUP ROLLBACK"
}

update_stack() {
  if docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then backup_stack; fi
  install_stack
}

restore_stack() {
  load_config
  source_file="${2:-}"
  confirmation="${3:-}"
  [[ -f "$source_file" ]] || die "Backup file not found: $source_file"
  [[ "$confirmation" == "RESTORE" ]] || die "Restore is destructive. Use: ./unraid.sh restore /path/to/backup.dump RESTORE"
  backup_stack
  docker stop "$APP_CONTAINER" >/dev/null 2>&1 || true
  echo "Restoring $source_file..."
  if docker exec -i "$DB_CONTAINER" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges < "$source_file"; then
    docker start "$APP_CONTAINER" >/dev/null
    echo "Restore complete."
  else
    docker start "$APP_CONTAINER" >/dev/null 2>&1 || true
    die "Restore failed; the pre-restore backup is available in $APPDATA_ROOT/kitchen-planner/backups"
  fi
}

rollback_cutover() {
  source_file="${2:-}"
  confirmation="${3:-}"
  [[ "$confirmation" == "ROLLBACK" ]] || die "Use: ./unraid.sh rollback-cutover /path/to/pre-cutover.dump ROLLBACK"
  restore_stack restore "$source_file" RESTORE
  set_env_value "DEMO_MODE" "true"
  set_env_value "SEED_SYNTHETIC_DATA" "true"
  docker rm -f "$APP_CONTAINER" >/dev/null
  start_app
  echo "Cutover rollback complete. The app is back in staging mode."
}

set_pin() {
  load_config
  member="${2:-}"
  [[ -n "$member" ]] || die 'Use: ./unraid.sh set-pin "Household member name"'
  read -r -s -p "New PIN for $member: " pin
  echo
  [[ ${#pin} -ge 4 ]] || die "PIN must be at least four characters"
  [[ ${#pin} -le 64 ]] || die "PIN must be no more than 64 characters"
  docker exec -e "NEW_PIN=$pin" "$APP_CONTAINER" node scripts/set-pin.mjs "$member"
  unset pin
}

start_stack() {
  load_config
  docker start "$DB_CONTAINER" >/dev/null
  wait_for_database
  docker start "$APP_CONTAINER" >/dev/null
  status_stack
}

stop_stack() {
  docker stop "$APP_CONTAINER" "$DB_CONTAINER"
}

status_stack() {
  load_config
  docker ps -a \
    --filter "name=^/${APP_CONTAINER}$" \
    --filter "name=^/${DB_CONTAINER}$" \
    --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  echo
  echo "Health endpoint: http://127.0.0.1:$APP_PORT/api/health"
}

logs_stack() {
  case "${2:-all}" in
    app) docker logs -f --tail=150 "$APP_CONTAINER" ;;
    db) docker logs -f --tail=150 "$DB_CONTAINER" ;;
    all)
      echo "--- $APP_CONTAINER ---"
      docker logs --tail=150 "$APP_CONTAINER"
      echo "--- $DB_CONTAINER ---"
      docker logs --tail=150 "$DB_CONTAINER"
      ;;
    *) die "Use: ./unraid.sh logs [app|db|all]" ;;
  esac
}

case "${1:-install}" in
  install) install_stack ;;
  update) update_stack ;;
  backup) backup_stack ;;
  cutover) cutover_stack "$@" ;;
  restore) restore_stack "$@" ;;
  rollback-cutover) rollback_cutover "$@" ;;
  set-pin) set_pin "$@" ;;
  start) start_stack ;;
  stop) stop_stack ;;
  restart) stop_stack; start_stack ;;
  status) status_stack ;;
  cleanup) cleanup_docker_storage ;;
  logs) logs_stack "$@" ;;
  *)
    echo "Usage: ./unraid.sh {install|update|backup|cutover BATCH_ID COMMIT|rollback-cutover FILE ROLLBACK|restore FILE RESTORE|set-pin NAME|start|stop|restart|status|cleanup|logs [app|db|all]}"
    exit 2
    ;;
esac
