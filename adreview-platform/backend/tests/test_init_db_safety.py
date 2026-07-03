"""Verify that init_db.py refuses to run without AGREE_RESET=YES.

This guards against accidental database resets during development.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest


def test_init_db_refuses_without_env_var():
    """init_db.py must exit with code 2 if AGREE_RESET is not set."""
    script = Path(__file__).parent.parent / "scripts" / "init_db.py"
    assert script.exists(), f"Script not found: {script}"

    # Run without AGREE_RESET
    env = os.environ.copy()
    env.pop("AGREE_RESET", None)

    result = subprocess.run(
        [sys.executable, str(script)],
        env=env,
        capture_output=True,
        text=True,
        cwd=script.parent.parent,  # backend/
    )

    assert result.returncode == 2, f"Expected exit code 2, got {result.returncode}"
    assert "DANGER" in result.stderr, "Expected DANGER message in stderr"
    assert "AGREE_RESET=YES" in result.stderr, "Expected env var hint in stderr"


def test_init_db_accepts_with_env_var():
    """init_db.py must proceed if AGREE_RESET=YES (but will fail on DB connection)."""
    script = Path(__file__).parent.parent / "scripts" / "init_db.py"
    assert script.exists(), f"Script not found: {script}"

    # Run with AGREE_RESET=YES — will fail on DB connection (no DB in test env),
    # but should NOT exit with code 2 (the safety check passed).
    env = os.environ.copy()
    env["AGREE_RESET"] = "YES"
    # Use a non-existent DB to ensure it doesn't actually connect
    env["DATABASE_URL"] = "postgresql+asyncpg://nonexistent:nonexistent@localhost:5432/nonexistent"

    result = subprocess.run(
        [sys.executable, str(script)],
        env=env,
        capture_output=True,
        text=True,
        cwd=script.parent.parent,
        timeout=5,
    )

    # Should NOT be exit code 2 (safety check passed)
    # Will be non-zero due to DB connection failure, but that's expected
    assert result.returncode != 2, "Safety check should pass with AGREE_RESET=YES"
    # Should NOT have the DANGER message (safety check passed)
    assert "DANGER" not in result.stderr or "AGREE_RESET=YES" not in result.stderr
