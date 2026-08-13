#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$BACKEND_DIR"

# 后台跑 bootstrap (DROP SCHEMA + create_all + seed 可能耗时较长),
# 不能阻塞 uvicorn 启动 — Render 端口扫描有超时限制.
(
  echo "[render_start] bootstrap DB in background..."
  PYTHONPATH=. python scripts/bootstrap_render_db.py 2>&1 | sed 's/^/[bootstrap] /'
  echo "[render_start] bootstrap complete"
) &

# 立即启动 uvicorn, 不等 bootstrap 完成
echo "[render_start] start uvicorn on port ${PORT:-8000}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
