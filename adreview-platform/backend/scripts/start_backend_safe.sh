#!/usr/bin/env bash
# Safe backend startup: dump PostgreSQL before launching uvicorn.
# 默认保留最近 14 份备份；dump 失败时 warn 但不阻塞启动。

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$REPO_ROOT/backend/storage/backups"
KEEP_COUNT="${ADREVIEW_BACKUP_KEEP:-14}"

mkdir -p "$BACKUP_DIR"

# Read connection params from backend/.env (best effort)
if [ -f "$REPO_ROOT/backend/.env" ]; then
    set -a
    . "$REPO_ROOT/backend/.env"
    set +a
fi

PGUSER_VAL="${POSTGRES_USER:-adreview}"
PGPASSWORD_VAL="${POSTGRES_PASSWORD:-adreview}"
PGHOST_VAL="${POSTGRES_HOST:-localhost}"
PGPORT_VAL="${POSTGRES_PORT:-5432}"
PGDATABASE_VAL="${POSTGRES_DB:-adreview}"

# Locate a pg_dump whose major version matches the running server.
# Resolve server version from /usr/bin/env-like chain; for now, prefer
# PostgreSQL 17's pg_dump if installed via Homebrew; fall back to PATH.
PGDUMP_BIN=""
for candidate in \
    /opt/homebrew/opt/postgresql@17/bin/pg_dump \
    /opt/homebrew/opt/postgresql@16/bin/pg_dump \
    /opt/homebrew/opt/postgresql@15/bin/pg_dump \
    "/Library/PostgreSQL/17/bin/pg_dump" \
    "/Library/PostgreSQL/16/bin/pg_dump"; do
    if [ -x "$candidate" ]; then
        PGDUMP_BIN="$candidate"
        break
    fi
done
PGDUMP_BIN="${PGDUMP_BIN:-$(command -v pg_dump 2>/dev/null || echo pg_dump)}"

TS="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="$BACKUP_DIR/adreview-${TS}.sql.gz"

DUMP_RC=0
PGPASSWORD="$PGPASSWORD_VAL" "$PGDUMP_BIN" \
    --host="$PGHOST_VAL" \
    --port="$PGPORT_VAL" \
    --username="$PGUSER_VAL" \
    --dbname="$PGDATABASE_VAL" \
    --no-owner --clean --if-exists \
    2>>"$BACKUP_DIR/dump.err" \
    | gzip > "$DUMP_FILE" || DUMP_RC=$?

if [ "$DUMP_RC" -ne 0 ]; then
    echo "[start_backend_safe] WARNING: pg_dump failed (rc=$DUMP_RC); starting anyway." >&2
    rm -f "$DUMP_FILE"
else
    SIZE=$(du -h "$DUMP_FILE" | cut -f1)
    echo "[start_backend_safe] dumped to $DUMP_FILE ($SIZE)"
fi

# Prune old backups
if [ -d "$BACKUP_DIR" ]; then
    ls -1tr "$BACKUP_DIR"/adreview-*.sql.gz 2>/dev/null | head -n -"$KEEP_COUNT" | while read -r f; do
        rm -f "$f" && echo "[start_backend_safe] pruned old backup $f"
    done
fi

# Launch uvicorn
source "$REPO_ROOT/backend/.venv/bin/activate"
cd "$REPO_ROOT/backend"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" \
    > "$REPO_ROOT/backend/storage/logs/backend-$(date +%Y%m%d-%H%M%S).log" 2>&1
