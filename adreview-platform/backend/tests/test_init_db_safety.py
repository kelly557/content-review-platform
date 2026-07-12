"""Verify that init_db.py refuses to run without the required env triple.

History: the original guard was just `AGREE_RESET=YES`. After the 2026-07-12
seed.py incident we hardened the script with a triple-gate
(AGREE_RESET + I_UNDERSTAND_DATA_LOSS + RESEED_ALLOWED) + a hidden
`--i-know` flag. These tests pin down the new policy.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest


def _run_script(script: Path, env: dict, *extra_args: str) -> subprocess.CompletedProcess:
    # The script imports `app.*` so PYTHONPATH must point at backend/.
    env = {**env, "PYTHONPATH": str(script.parent.parent)}
    return subprocess.run(
        [sys.executable, str(script), *extra_args],
        env=env,
        capture_output=True,
        text=True,
        cwd=script.parent.parent,  # backend/
        timeout=10,
    )


def test_init_db_refuses_without_env_var():
    """init_db.py must exit with code 2 if AGREE_RESET is not set."""
    script = Path(__file__).parent.parent / "scripts" / "init_db.py"
    assert script.exists(), f"Script not found: {script}"

    env = os.environ.copy()
    env.pop("AGREE_RESET", None)
    env.pop("I_UNDERSTAND_DATA_LOSS", None)
    env.pop("RESEED_ALLOWED", None)

    result = _run_script(script, env)

    assert result.returncode == 2, f"Expected exit code 2, got {result.returncode}\nstderr:\n{result.stderr}"
    assert "DANGER" in result.stderr, "Expected DANGER message in stderr"


def test_init_db_refuses_with_just_one_env_var():
    """All three env vars must be set; one alone is insufficient."""
    script = Path(__file__).parent.parent / "scripts" / "init_db.py"

    env = os.environ.copy()
    env["AGREE_RESET"] = "YES"  # only this one
    env.pop("I_UNDERSTAND_DATA_LOSS", None)
    env.pop("RESEED_ALLOWED", None)

    result = _run_script(script, env)
    assert result.returncode == 2, "Triple-gate must enforce ALL three env vars"
    assert "I_UNDERSTAND_DATA_LOSS" in result.stderr
    assert "RESEED_ALLOWED" in result.stderr


def test_init_db_refuses_with_envs_but_no_cli_flag():
    """All three env vars set but `--i-know` missing -> still refused."""
    script = Path(__file__).parent.parent / "scripts" / "init_db.py"

    env = os.environ.copy()
    env["AGREE_RESET"] = "YES"
    env["I_UNDERSTAND_DATA_LOSS"] = "I_UNDERSTAND_DATA_LOSS"
    env["RESEED_ALLOWED"] = "YES"
    env["DATABASE_URL"] = "postgresql+asyncpg://nonexistent:nonexistent@localhost:5432/nonexistent"

    result = _run_script(script, env)
    assert result.returncode == 2, "Without --i-know even triple-env should refuse"
    assert "--i-know" in result.stderr


def test_init_db_passes_safety_with_full_attestation():
    """All three env vars + --i-know -> safety check passes; only DB connection fails."""
    script = Path(__file__).parent.parent / "scripts" / "init_db.py"

    env = os.environ.copy()
    env["AGREE_RESET"] = "YES"
    env["I_UNDERSTAND_DATA_LOSS"] = "I_UNDERSTAND_DATA_LOSS"
    env["RESEED_ALLOWED"] = "YES"
    env["DATABASE_URL"] = "postgresql+asyncpg://nonexistent:nonexistent@localhost:5432/nonexistent"

    result = _run_script(script, env, "--i-know")
    # Safety check passed (no DANGER/AGREE_RESET line in stderr); DB connection fails,
    # which is a non-2 exit code.
    assert result.returncode != 2, "Safety check should pass with full attestation"
    assert "DANGER" not in result.stderr
    assert "AGREE_RESET=YES" not in result.stderr
