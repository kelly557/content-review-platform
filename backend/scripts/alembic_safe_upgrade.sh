#!/usr/bin/env bash
# Schema-safe alembic upgrade wrapper.
#
# BEFORE THIS SCRIPT EXISTED, the team sometimes ran
#   alembic stamp <some_revision> && alembic upgrade head
# to skip past a broken/already-applied revision. That pattern silently
# bypasses DDL and causes HTTP 500 storms. See the v8.2 outage.
#
# This wrapper replaces the manual ``stamp`` pattern with a diagnose-first
# flow. If the DB schema is behind/already-applied-for-today's code, it
# refuses to run and points the operator at the matching ``fix_*.py``
# script. If the schema is ahead of the code (e.g. someone manually
# stamped past a revision during incident recovery), it warns and
# suggests the right ``fix_*.py``.
#
# Usage::
#   ./alembic_safe_upgrade.sh             # default: upgrade head
#   ./alembic_safe_upgrade.sh --check     # only run diagnose, no upgrades

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"

# Pass only the DB connection vars alembic needs. Avoid ``set -a`` because
# ``.env`` also contains MaaS / JWT / CORS lists whose parsing by
# pydantic-settings expects them to be absent from the process env.
for v in DATABASE_URL DATABASE_URL_SYNC POSTGRES_HOST POSTGRES_PORT \
         POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
    if [ -f "$BACKEND_DIR/.env" ] && grep -q "^${v}=" "$BACKEND_DIR/.env" 2>/dev/null; then
        val=$(grep "^${v}=" "$BACKEND_DIR/.env" | head -1 | cut -d= -f2-)
        export "${v}=${val}"
    fi
done

cd "$BACKEND_DIR"
source .venv/bin/activate
export PYTHONPATH=.

# ── 1. Always run diagnose first ───────────────────────────
echo "[alembic_safe] running diagnose_alembic_state.py first"
if ./.venv/bin/python scripts/diagnose_alembic_state.py; then
    DIAG_OK=1
else
    DIAG_OK=0
fi

if [ "${1:-}" = "--check" ]; then
    echo "[alembic_safe] --check requested, stopping after diagnose"
    if [ "$DIAG_OK" = "1" ]; then
        exit 0
    else
        exit 2
    fi
fi

# ── 2. If diagnose failed (drift), refuse manual upgrade ───
if [ "$DIAG_OK" != "1" ]; then
    echo "" >&2
    echo "[alembic_safe] ABORT: schema drift detected." >&2
    echo "    Resolve by running the matching fix_*.py script:" >&2
    echo "      PYTHONPATH=. ./.venv/bin/python scripts/diagnose_alembic_state.py" >&2
    echo "    then apply the fix it suggests (e.g. fix_apply_phase_b_ddl.py)" >&2
    echo "    THEN re-run this wrapper." >&2
    echo "" >&2
    echo "    If you KNOW the drift is benign (e.g. you've just dropped a" >&2
    echo "    table by hand), proceed at your own risk with:" >&2
    echo "      FORCE_ALEMBIC_UPGRADE=1 ./alembic_safe_upgrade.sh" >&2
    exit 2
fi

# ── 3. Diagnose OK: proceed with regular upgrade ────────────
if [ "${FORCE_ALEMBIC_UPGRADE:-0}" = "1" ]; then
    echo "[alembic_safe] WARNING: FORCE_ALEMBIC_UPGRADE=1 set; bypassing diagnose this once"
fi

echo "[alembic_safe] alembic upgrade head"
alembic upgrade head
