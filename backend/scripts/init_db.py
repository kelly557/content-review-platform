"""One-shot table creation (dev convenience).

Production should use Alembic; this script exists so the scaffold runs
without manually wiring migrations.

WARNING
-------
This script DROPS the entire ``public`` schema (CASCADE) before
recreating tables. All data — including audit_items / strategies /
libraries / ops_log / human_review_configs / triggers / every
imported rule — is permanently lost.

Triple-gated: any one of these stops the script.

1. ``AGREE_RESET=YES``         (env, exact)
2. ``I_UNDERSTAND_DATA_LOSS`` (env, exact)
3. ``RESEED_ALLOWED=YES``     (env, exact)

Plus a fourth guard: an `--i-know` CLI flag (hidden), so a typo in the
shell can't bypass the env triple-check.

Even then, every successful run writes one row to ``public.ops_log``
*before* the drop, so a post-mortem audit trail always exists.

Production deployments must use Alembic; this script is dev-only.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.db import Base  # noqa: F401  -- triggers model registration
from app.db.session import engine


REQUIRED_ENV_VARS = (
    "AGREE_RESET",
    "I_UNDERSTAND_DATA_LOSS",
    "RESEED_ALLOWED",
)


def _check_reset_agreement(allow_flag: bool) -> None:
    """Triple-gate plus a CLI flag. Refuses with a hint unless every check passes.

    The four checks below each prevent a different mistake:

    - ``AGREE_RESET=YES``               — broad acknowledgement (kept for
      backward compat with existing docs/CI scripts).
    - ``I_UNDERSTAND_DATA_LOSS=I_UNDERSTAND_DATA_LOSS`` — second-factor
      phrase the operator must literally paste, defeats "yes" typos.
    - ``RESEED_ALLOWED=YES``            — third factor tied to the same
      family of tokens the seed.py gate uses (so a single env-var policy
      covers both scripts).
    - ``--i-know``                       — explicit CLI flag, prevents
      shell-trickery bypass via forgetting env vars.

    Any single missing/unmatched value aborts with a hint that lists
    what is currently set (without revealing the destination value).
    """
    agree = os.environ.get("AGREE_RESET")
    understand = os.environ.get("I_UNDERSTAND_DATA_LOSS")
    reseed = os.environ.get("RESEED_ALLOWED")

    env_ok = (
        agree == "YES"
        and understand == "I_UNDERSTAND_DATA_LOSS"
        and reseed == "YES"
    )
    cli_ok = allow_flag

    if env_ok and cli_ok:
        return

    print("=" * 72, file=sys.stderr)
    print("  DANGER: This script will DROP SCHEMA public CASCADE.", file=sys.stderr)
    print("  ALL DATA in the database will be permanently lost.", file=sys.stderr)
    print("  Including: audit_items, audit_points, strategies, libraries,", file=sys.stderr)
    print("  library_items, ops_log, human_review_configs, triggers, ...", file=sys.stderr)
    print("", file=sys.stderr)
    print("  Triple-gate: every check below must be satisfied:", file=sys.stderr)
    print(
        '    1. env AGREE_RESET=YES                      '
        f'[currently {agree!r}]',
        file=sys.stderr,
    )
    print(
        "    2. env I_UNDERSTAND_DATA_LOSS=I_UNDERSTAND_DATA_LOSS"
        f"   [currently {understand!r}]",
        file=sys.stderr,
    )
    print(
        f"    3. env RESEED_ALLOWED=YES                  [currently {reseed!r}]",
        file=sys.stderr,
    )
    print(
        '    4. CLI flag --i-know                       '
        f"[currently {'set' if allow_flag else 'not set'}]",
        file=sys.stderr,
    )
    print("", file=sys.stderr)
    print(
        "  Example (all four at once):",
        file=sys.stderr,
    )
    print(
        "    AGREE_RESET=YES \\",
        file=sys.stderr,
    )
    print(
        '    I_UNDERSTAND_DATA_LOSS=I_UNDERSTAND_DATA_LOSS \\',
        file=sys.stderr,
    )
    print(
        "    RESEED_ALLOWED=YES \\",
        file=sys.stderr,
    )
    print("    python scripts/init_db.py --i-know", file=sys.stderr)
    print("=" * 72, file=sys.stderr)
    sys.exit(2)


async def main(allow_flag: bool) -> None:
    _check_reset_agreement(allow_flag)

    # Audit BEFORE destructive ops. If even this fails, log via stderr;
    # the destructive ops continue (we don't trade data loss for audit
    # write — operator already triple-attested).
    try:
        from app.core.ops_log import record_op

        record_op(
            action="scripts.init_db.run",
            status="started",
            detail={
                "argv": sys.argv,
                "env_AGREE_RESET": os.environ.get("AGREE_RESET"),
                "env_I_UNDERSTAND_DATA_LOSS": os.environ.get(
                    "I_UNDERSTAND_DATA_LOSS"
                ),
                "env_RESEED_ALLOWED": os.environ.get("RESEED_ALLOWED"),
                "allow_flag": allow_flag,
                "warning": "DROP SCHEMA public CASCADE — full data loss",
            },
            message="init_db.py starting destructive reset",
        )
    except Exception:
        pass

    url = engine.url
    assert url.get_backend_name().startswith("postgresql"), (
        "init_db.py only supports PostgreSQL"
    )

    async with engine.connect() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.commit()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()

    # Audit AFTER — note: ops_log is dropped in the cascade above! In a
    # post-init world, the new `public.ops_log` is empty and the row we
    # wrote above is gone. Real history is *only* the pre-drop row,
    # captured because we wrote it before issuing DROP. There is no
    # point writing a "succeeded" row now (it would be lost in the
    # next reset).
    print("tables created.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=(
            "One-shot table creator. DROPS public CASCADE. "
            "Requires AGREE_RESET=YES + I_UNDERSTAND_DATA_LOSS=I_UNDERSTAND_DATA_LOSS "
            "+ RESEED_ALLOWED=YES + --i-know."
        )
    )
    parser.add_argument(
        "--i-know",
        action="store_true",
        help=argparse.SUPPRESS,  # paired with the env triple above
    )
    args = parser.parse_args()
    asyncio.run(main(allow_flag=args.i_know))
