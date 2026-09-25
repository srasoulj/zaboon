#!/usr/bin/env bash
# Local Postgres for development and tests: no Docker needed.
#
#   bash scripts/db-local.sh ensure   # install extensions if needed, init + start the cluster, migrate (idempotent, never resets data)
#   bash scripts/db-local.sh status
#   bash scripts/db-local.sh stop
#   bash scripts/db-local.sh url      # print the app_server DATABASE_URL
#
# The cluster mirrors Supabase: the superuser is `supabase_admin`, and `postgres` (the migration
# role) is NOT a superuser. Data lives OUTSIDE the repo (default /var/lib/zaboon-pg) so every
# git worktree shares one server. Override with ZABOON_PGDATA / ZABOON_DB_PORT / ZABOON_DB_NAME.
set -euo pipefail

PG_MAJOR=16
PGBIN="/usr/lib/postgresql/${PG_MAJOR}/bin"
PGROOT="${ZABOON_PGROOT:-/var/lib/zaboon-pg}"
PGDATA="${ZABOON_PGDATA:-$PGROOT/data}"
PGPORT="${ZABOON_DB_PORT:-54322}"
DB="${ZABOON_DB_NAME:-zaboon}"
HOST=127.0.0.1
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

as_postgres() {
  if [ "$(id -u)" -eq 0 ]; then runuser -u postgres -- "$@"; else sudo -u postgres "$@"; fi
}

log() { echo "[db-local] $*" >&2; }

install_packages() {
  local missing=()
  [ -x "$PGBIN/postgres" ] || missing+=("postgresql-${PG_MAJOR}")
  [ -f "/usr/share/postgresql/${PG_MAJOR}/extension/pgtap.control" ] || missing+=("postgresql-${PG_MAJOR}-pgtap")
  [ -f "/usr/share/postgresql/${PG_MAJOR}/extension/pg_cron.control" ] || missing+=("postgresql-${PG_MAJOR}-cron")
  if [ ${#missing[@]} -gt 0 ]; then
    log "installing ${missing[*]}"
    export DEBIAN_FRONTEND=noninteractive
    $SUDO apt-get install -y -q "${missing[@]}" >/dev/null 2>&1 || {
      $SUDO apt-get update -q >/dev/null
      $SUDO apt-get install -y -q "${missing[@]}" >/dev/null
    }
  fi
  # Ubuntu's postgresql package may auto-create and start a default cluster on 5432; we don't use it.
}

init_cluster() {
  if [ -s "$PGDATA/PG_VERSION" ]; then return; fi
  log "initializing cluster in $PGDATA (port $PGPORT)"
  $SUDO mkdir -p "$PGDATA"
  $SUDO chown -R postgres:postgres "$PGROOT"
  as_postgres "$PGBIN/initdb" -D "$PGDATA" -U supabase_admin --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
  as_postgres tee -a "$PGDATA/postgresql.conf" >/dev/null <<CONF

# --- zaboon local dev settings ---
port = $PGPORT
listen_addresses = '127.0.0.1'
unix_socket_directories = '/tmp'
shared_preload_libraries = 'pg_cron'
cron.database_name = '$DB'
max_connections = 300
# Dev/test speed; never use these settings in production.
fsync = off
synchronous_commit = off
full_page_writes = off
CONF
}

is_running() { as_postgres "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; }

start_cluster() {
  if is_running; then return; fi
  log "starting postgres on $HOST:$PGPORT"
  as_postgres "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGROOT/postgres.log" -w -t 60 start >/dev/null
}

psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -h "$HOST" -p "$PGPORT" -U supabase_admin "$@"; }

ensure_database() {
  local name="$1"
  if ! psql_admin -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$name'" | grep -q 1; then
    log "creating database $name"
    psql_admin -d postgres -c "CREATE DATABASE \"$name\""
  fi
}

migrate() {
  (cd "$REPO_ROOT" && ZABOON_DB_PORT="$PGPORT" ZABOON_DB_NAME="$DB" pnpm exec tsx scripts/migrate.ts)
}

cmd="${1:-ensure}"
case "$cmd" in
  ensure)
    install_packages
    init_cluster
    start_cluster
    ensure_database "$DB"
    migrate
    log "ready: $(bash "$0" url)"
    ;;
  start)
    start_cluster
    ;;
  stop)
    if is_running; then as_postgres "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null; log "stopped"; fi
    ;;
  status)
    if is_running; then echo "running on $HOST:$PGPORT (data: $PGDATA)"; else echo "stopped"; exit 1; fi
    ;;
  url)
    echo "postgres://app_server:app_server_local@$HOST:$PGPORT/$DB" # pragma: allowlist secret (local-only dev credential)
    ;;
  *)
    echo "usage: $0 {ensure|start|stop|status|url}" >&2
    exit 2
    ;;
esac
