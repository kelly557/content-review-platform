#!/usr/bin/env bash
# Safe backend startup: dump PostgreSQL before launching uvicorn.
#
# P2 hardening (v8.2 follow-up): before launching, run a schema-drift
# preflight against the live PG. If the alembic stamp claims a revision
# was applied but the schema is missing tables/columns, refuse to start
# (instead of silently booting with HTTP 500). See scripts/diagnose_alembic_state.py.
#
# 默认保留最近 14 份备份；dump 失败时 warn 但不阻塞启动。
#
# Env vars:
#   DRY_RUN=1               run preflight + skip dump + skip uvicorn launch
#                            (used by smoke tests / CI)
#   SKIP_ALEMBIC_PREFLIGHT=1   bypass the diagnose check (NOT RECOMMENDED —
#                            was the root cause of the v8.2 outage).
#   ADREVIEW_BACKUP_KEEP=N  keep last N backups (default 14).

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# SCRIPT_DIR = backend/scripts; BACKEND_DIR = backend; REPO_ROOT = test
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"
BACKUP_DIR="$BACKEND_DIR/storage/backups"
LOG_DIR="$BACKEND_DIR/storage/logs"
KEEP_COUNT="${ADREVIEW_BACKUP_KEEP:-14}"
DRY_RUN="${DRY_RUN:-0}"
SKIP_PREFLIGHT="${SKIP_ALEMBIC_PREFLIGHT:-0}"

mkdir -p "$BACKUP_DIR" "$LOG_DIR"

# Read DB connection params from .env (best effort). Don't ``set -a`` —
# .env also contains MaaS / JWT / CORS lists whose pydantic-settings
# parsing breaks when exported into the shell environment.
PGUSER_VAL="${POSTGRES_USER:-adreview}"
PGPASSWORD_VAL="${POSTGRES_PASSWORD:-adreview}"
PGHOST_VAL="${POSTGRES_HOST:-localhost}"
PGPORT_VAL="${POSTGRES_PORT:-5432}"
PGDATABASE_VAL="${POSTGRES_DB:-adreview}"
if [ -f "$BACKEND_DIR/.env" ]; then
    for v in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_HOST POSTGRES_PORT POSTGRES_DB; do
        if grep -q "^${v}=" "$BACKEND_DIR/.env" 2>/dev/null; then
            val=$(grep "^${v}=" "$BACKEND_DIR/.env" | head -1 | cut -d= -f2-)
            if [ -n "$val" ]; then
                case $v in
                    POSTGRES_USER) PGUSER_VAL="$val" ;;
                    POSTGRES_PASSWORD) PGPASSWORD_VAL="$val" ;;
                    POSTGRES_HOST) PGHOST_VAL="$val" ;;
                    POSTGRES_PORT) PGPORT_VAL="$val" ;;
                    POSTGRES_DB) PGDATABASE_VAL="$val" ;;
                esac
            fi
        fi
    done
fi

# Activate venv BEFORE preflight so it can find Python packages.
# shellcheck disable=SC1090
source "$BACKEND_DIR/.venv/bin/activate"
cd "$BACKEND_DIR"

# ──────────────────────────────────────────────────────────────
# P2 hardening: preflight schema-drift check. ALWAYS run unless
# SKIP_ALEMBIC_PREFLIGHT=1 is set. The preflight is read-only against
# PG, so it's safe to run regardless of DRY_RUN.
# ──────────────────────────────────────────────────────────────
if [ "$SKIP_PREFLIGHT" = "1" ]; then
    echo "[start_backend_safe] WARNING: skipping alembic preflight per SKIP_ALEMBIC_PREFLIGHT=1" >&2
else
    echo "[start_backend_safe] preflight: scripts/diagnose_alembic_state.py"
    if ! PYTHONPATH=. ./.venv/bin/python scripts/diagnose_alembic_state.py; then
        echo "" >&2
        echo "[start_backend_safe] ABORT: alembic stamp and PG schema disagree." >&2
        echo "    Either:" >&2
        echo "      a) Run scripts/fix_apply_phase_b_ddl.py (or the matching fix_*_*.py)" >&2
        echo "         to bring the schema up to the latest revision, OR" >&2
        echo "      b) Run \`alembic upgrade head\` if you've only made code edits" >&2
        echo "         without DDL changes (this re-runs the latest migrations cleanly)." >&2
        echo "      c) Override with SKIP_ALEMBIC_PREFLIGHT=1 if you're absolutely sure" >&2
        echo "         this is fine (NOT RECOMMENDED — was the root cause of the v8.2 outage)." >&2
        exit 1
    fi
    echo "[start_backend_safe] preflight OK"
fi

# Locate a pg_dump whose major version matches the running server.
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

# DRY_RUN: stop here, used by CI / smoke tests
if [ "$DRY_RUN" = "1" ]; then
    echo "[start_backend_safe] DRY_RUN=1 set; not launching uvicorn"
    exit 0
fi

# Launch uvicorn
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" \
    > "$LOG_DIR/backend-$(date +%Y%m%d-%H%M%S).log" 2>&1
