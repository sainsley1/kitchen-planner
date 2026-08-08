#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE="${ENV_FILE:-.env}"
APP_IMAGE="kitchen-planner:local"
APP_CONTAINER="kitchen-planner-app"
DB_CONTAINER="kitchen-planner-db"
NETWORK="kitchen-planner-internal"
APP_RELEASE_VERSION="0.7.0"

# ANSI Color formatting
CYAN="\033[96m"
GREEN="\033[92m"
YELLOW="\033[93m"
BOLD="\033[1m"
RESET="\033[0m"

die() {
  echo -e "${YELLOW}ERROR:${RESET} $*" >&2
  exit 1
}

load_config() {
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE does not exist. Run: ./unraid.sh install"
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

interactive_setup() {
  echo -e "\n${BOLD}${CYAN}=================================================================${RESET}"
  echo -e "${BOLD}${CYAN}  🥗 Kitchen Planner Interactive Installation & Setup Wizard  ${RESET}"
  echo -e "${BOLD}${CYAN}=================================================================${RESET}"
  echo "Welcome! This wizard will guide you through setting up Kitchen Planner"
  echo "on your Unraid server or Linux environment."
  echo

  # 1. Storage & App Data Location
  echo -e "${BOLD}--- 1. Storage & App Data Location ---${RESET}"
  local default_appdata="${APPDATA_ROOT:-/mnt/user/appdata}"
  read -r -p "Appdata root directory [$default_appdata]: " input_appdata
  APPDATA_ROOT="${input_appdata:-$default_appdata}"
  echo -e "${GREEN}✓ Appdata root set to:${RESET} $APPDATA_ROOT"
  echo

  # 2. Network & Application Port
  echo -e "${BOLD}--- 2. Network & Application Port ---${RESET}"
  local default_port="${APP_PORT:-8790}"
  while true; do
    read -r -p "Web Application Port [$default_port]: " input_port
    APP_PORT="${input_port:-$default_port}"
    if [[ "$APP_PORT" =~ ^[0-9]+$ ]] && (( APP_PORT >= 1024 && APP_PORT <= 65535 )); then
      break
    fi
    echo -e "${YELLOW}⚠️ Invalid port. Please enter an integer between 1024 and 65535.${RESET}"
  done
  echo -e "${GREEN}✓ Web application port set to:${RESET} $APP_PORT"
  echo

  # 3. Database Credentials
  echo -e "${BOLD}--- 3. PostgreSQL Database Setup ---${RESET}"
  local default_db_name="${POSTGRES_DB:-kitchen_planner}"
  read -r -p "PostgreSQL Database Name [$default_db_name]: " input_db_name
  POSTGRES_DB="${input_db_name:-$default_db_name}"

  local default_db_user="${POSTGRES_USER:-kitchen_planner}"
  read -r -p "PostgreSQL Database User [$default_db_user]: " input_db_user
  POSTGRES_USER="${input_db_user:-$default_db_user}"

  local auto_pg_pass
  auto_pg_pass="$(openssl rand -hex 16 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom 2>/dev/null | head -c 32 || echo 'kp-secret-pg-pass')"

  read -r -p "PostgreSQL Password (press Enter to auto-generate): " input_pg_pass
  POSTGRES_PASSWORD="${input_pg_pass:-$auto_pg_pass}"
  DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}"
  echo -e "${GREEN}✓ PostgreSQL database configuration complete.${RESET}"
  echo

  # 4. Household & Security Setup
  echo -e "${BOLD}--- 4. Household & Security Setup ---${RESET}"
  local default_hname="${APP_HOUSEHOLD_NAME:-Kitchen}"
  read -r -p "Household Name [$default_hname]: " input_hname
  APP_HOUSEHOLD_NAME="${input_hname:-$default_hname}"

  local auto_secret
  auto_secret="$(openssl rand -hex 24 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom 2>/dev/null | head -c 48 || echo 'kp-session-secret-key')"
  read -r -p "Session Secret Key (press Enter to auto-generate): " input_secret
  HOUSEHOLD_SESSION_SECRET="${input_secret:-$auto_secret}"

  local default_u1_name="${HOUSEHOLD_USER_1_NAME:-Owner}"
  read -r -p "Primary User Name [$default_u1_name]: " input_u1_name
  HOUSEHOLD_USER_1_NAME="${input_u1_name:-$default_u1_name}"

  while true; do
    read -r -s -p "Primary User PIN (min 4 characters): " input_u1_pin
    echo
    if [[ ${#input_u1_pin} -ge 4 ]]; then
      HOUSEHOLD_USER_1_PIN="$input_u1_pin"
      break
    fi
    echo -e "${YELLOW}⚠️ PIN must be at least 4 characters long.${RESET}"
  done

  local default_u2_name="${HOUSEHOLD_USER_2_NAME:-Member}"
  read -r -p "Secondary User Name [$default_u2_name]: " input_u2_name
  HOUSEHOLD_USER_2_NAME="${input_u2_name:-$default_u2_name}"

  while true; do
    read -r -s -p "Secondary User PIN (min 4 characters): " input_u2_pin
    echo
    if [[ ${#input_u2_pin} -ge 4 ]]; then
      HOUSEHOLD_USER_2_PIN="$input_u2_pin"
      break
    fi
    echo -e "${YELLOW}⚠️ PIN must be at least 4 characters long.${RESET}"
  done

  local default_tz="${APP_TIME_ZONE:-America/Vancouver}"
  if [[ -f /etc/timezone ]]; then
    default_tz="$(cat /etc/timezone)"
  fi
  read -r -p "App Time Zone [$default_tz]: " input_tz
  APP_TIME_ZONE="${input_tz:-$default_tz}"
  echo -e "${GREEN}✓ Household & authentication settings configured.${RESET}"
  echo

  # 5. OpenAI API Key
  echo -e "${BOLD}--- 5. OpenAI Integration (AI Meal Planning & Flyer Intelligence) ---${RESET}"
  echo "Kitchen Planner uses OpenAI for camera recipe parsing, flyer price intelligence, and weekly meal planning."
  read -r -p "OpenAI API Key (press Enter to skip and configure later): " input_openai_key
  OPENAI_API_KEY="${input_openai_key:-${OPENAI_API_KEY:-}}"
  echo

  # 6. Operating Mode
  echo -e "${BOLD}--- 6. Operating Mode ---${RESET}"
  echo "  1) Production Mode  - Clean database for live household use (Recommended)"
  echo "  2) Staging/Demo Mode - Pre-populated with synthetic sample recipes and flyer items"
  read -r -p "Select Mode [1]: " mode_choice
  if [[ "$mode_choice" == "2" ]]; then
    DEMO_MODE="true"
    SEED_SYNTHETIC_DATA="true"
  else
    DEMO_MODE="false"
    SEED_SYNTHETIC_DATA="false"
  fi
  echo -e "${GREEN}✓ Operating mode set.${RESET}"
  echo

  # 7. Summary & Confirmation
  echo -e "${BOLD}${CYAN}=================================================================${RESET}"
  echo -e "${BOLD}  Configuration Summary:${RESET}"
  echo -e "${BOLD}${CYAN}=================================================================${RESET}"
  echo "  Appdata Directory : $APPDATA_ROOT/kitchen-planner"
  echo "  Web Port          : $APP_PORT"
  echo "  PostgreSQL DB     : $POSTGRES_DB (user: $POSTGRES_USER)"
  echo "  Household Name    : $APP_HOUSEHOLD_NAME"
  echo "  Primary User      : $HOUSEHOLD_USER_1_NAME (PIN configured)"
  echo "  Secondary User    : $HOUSEHOLD_USER_2_NAME (PIN configured)"
  echo "  Time Zone         : $APP_TIME_ZONE"
  echo "  OpenAI API Key    : $( [[ -n "$OPENAI_API_KEY" ]] && echo 'Configured' || echo 'Not Configured (Optional)' )"
  echo "  Operating Mode    : $( [[ "$DEMO_MODE" == "true" ]] && echo 'Demo / Staging' || echo 'Production' )"
  echo -e "${BOLD}${CYAN}=================================================================${RESET}"
  echo

  read -r -p "Save configuration to $ENV_FILE and proceed with installation? [Y/n]: " confirm_save
  if [[ ! "$confirm_save" =~ ^[Yy]?$ ]]; then
    die "Installation aborted by user."
  fi

  cat <<EOF > "$ENV_FILE"
# Kitchen Planner Configuration File (.env)
APPDATA_ROOT=$APPDATA_ROOT
APP_PORT=$APP_PORT

POSTGRES_DB=$POSTGRES_DB
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DATABASE_URL=$DATABASE_URL

APP_VERSION=$APP_RELEASE_VERSION
DEMO_MODE=$DEMO_MODE
SEED_SYNTHETIC_DATA=$SEED_SYNTHETIC_DATA
AUTH_MODE=household
APP_HOUSEHOLD_NAME=$APP_HOUSEHOLD_NAME
APP_TIME_ZONE=$APP_TIME_ZONE
HOUSEHOLD_SESSION_SECRET=$HOUSEHOLD_SESSION_SECRET
HOUSEHOLD_USER_1_NAME=$HOUSEHOLD_USER_1_NAME
HOUSEHOLD_USER_1_PIN=$HOUSEHOLD_USER_1_PIN
HOUSEHOLD_USER_2_NAME=$HOUSEHOLD_USER_2_NAME
HOUSEHOLD_USER_2_PIN=$HOUSEHOLD_USER_2_PIN

OPENAI_API_KEY=$OPENAI_API_KEY
OPENAI_ECONOMY_MODEL=${OPENAI_ECONOMY_MODEL:-gpt-5.4-mini}
OPENAI_ROUTINE_MODEL=${OPENAI_ROUTINE_MODEL:-gpt-5.4}
OPENAI_FALLBACK_MODEL=${OPENAI_FALLBACK_MODEL:-gpt-5.6-terra}
OPENAI_RECONCILIATION_MODEL=${OPENAI_RECONCILIATION_MODEL:-gpt-5.4}
OPENAI_PLANNING_MODEL=${OPENAI_PLANNING_MODEL:-gpt-5.6-sol}
OPENAI_PLANNING_REASONING_EFFORT=${OPENAI_PLANNING_REASONING_EFFORT:-high}
OPENAI_PLANNING_TIMEOUT_MS=${OPENAI_PLANNING_TIMEOUT_MS:-1800000}
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
EOF

  echo -e "${GREEN}✓ Configuration saved to $ENV_FILE.${RESET}"
  echo
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
  local force_interactive=false
  local interactive_mode=true

  for arg in "$@"; do
    case "$arg" in
      --interactive|-i|setup) force_interactive=true ;;
      --non-interactive|--no-prompt) interactive_mode=false ;;
    esac
  done

  if [[ ! -f "$ENV_FILE" ]]; then
    if [[ "$interactive_mode" == true && -t 0 ]]; then
      interactive_setup
    else
      echo "--> Non-interactive mode detected. Creating $ENV_FILE from template..."
      cp .env.example "$ENV_FILE"
      local auto_pass
      auto_pass="$(openssl rand -hex 16 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom 2>/dev/null | head -c 32 || echo 'kp-pass')"
      local auto_sec
      auto_sec="$(openssl rand -hex 24 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom 2>/dev/null | head -c 48 || echo 'kp-sec')"
      sed -i "s|replace-with-a-long-random-password|$auto_pass|g" "$ENV_FILE"
      sed -i "s|replace-before-importing-real-data|$auto_sec|g" "$ENV_FILE"
    fi
  elif [[ "$force_interactive" == true ]]; then
    interactive_setup
  else
    if [[ "$interactive_mode" == true && -t 0 ]]; then
      read -r -p "Found existing $ENV_FILE. Re-run interactive setup wizard? [y/N]: " rerun_setup
      if [[ "$rerun_setup" =~ ^[Yy]$ ]]; then
        interactive_setup
      fi
    fi
  fi

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
  install_stack "$@"
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
  install) install_stack "$@" ;;
  setup|configure) interactive_setup ;;
  update) update_stack "$@" ;;
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
    echo "Usage: ./unraid.sh {install|setup|update|backup|cutover BATCH_ID COMMIT|rollback-cutover FILE ROLLBACK|restore FILE RESTORE|set-pin NAME|start|stop|restart|status|cleanup|logs [app|db|all]}"
    exit 2
    ;;
esac
