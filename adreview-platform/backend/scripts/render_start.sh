#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$BACKEND_DIR"

echo "[render_start] alembic upgrade head"
PYTHONPATH=. python scripts/bootstrap_render_db.py

echo "[render_start] start uvicorn"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
