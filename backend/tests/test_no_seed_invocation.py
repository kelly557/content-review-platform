"""Project-tree linter check: refuse accidental invocations of scripts/seed.py.

This test runs `backend/scripts/check_no_seed_ref.sh` over the entire
project tree and fails if any CI/startup/hook script would call
`scripts/seed.py`. See CLAUDE.md "不允许用 seed.py / init_db.py 重置
数据库" for context.

The script lives in backend/scripts so it can also be invoked manually
and from frontend/package.json's `lint:no-seed` npm script.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
LINTER = REPO_ROOT / "backend" / "scripts" / "check_no_seed_ref.sh"


def test_no_seed_invocation_in_project_tree() -> None:
    """Fail if any project file invokes scripts/seed.py."""
    assert LINTER.exists(), f"Linter script missing: {LINTER}"
    proc = subprocess.run(
        ["bash", str(LINTER)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        pytest.fail(
            "scripts/seed.py must not be invoked from any non-allow-listed "
            "project script. Run `bash backend/scripts/check_no_seed_ref.sh` "
            "to see offending lines."
        )


import pytest  # noqa: E402  (placed after the test for grouping clarity)
