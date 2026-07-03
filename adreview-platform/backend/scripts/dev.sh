#!/usr/bin/env bash
# Bootstraps dev environment: create venv, install deps, run uvicorn.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install --upgrade pip wheel
pip install -r requirements.txt

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "Created .env from .env.example - edit it before running."
fi

export PYTHONPATH=.
exec uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
