"""Safely repair the default privileged accounts without reseeding other data.

Usage:
    PYTHONPATH=. python3 scripts/repair_default_admins.py --apply --reason "render login recovery"

Behavior:
    - Only touches admin / superadmin / root_admin default accounts.
    - Creates missing accounts.
    - Resets hashed passwords to the configured default admin passwords.
    - Reactivates soft-deleted / inactive default privileged accounts.
    - Leaves all non-default users and business data untouched.
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal, engine
from app.models.user import User, UserRole


DEFAULT_PRIVILEGED_ACCOUNTS = [
    {
        "email": "admin@adreview.example.com",
        "full_name": "系统管理员",
        "role": UserRole.ADMIN,
        "password": settings.default_admin_password,
    },
    {
        "email": "superadmin@adreview.example.com",
        "full_name": "超级管理员",
        "role": UserRole.SUPERADMIN,
        "password": settings.default_superadmin_password,
    },
    {
        "email": "rootadmin@adreview.example.com",
        "full_name": "根管理员",
        "role": UserRole.ROOT_ADMIN,
        "password": settings.default_root_admin_password,
    },
]


async def repair_default_admins(*, apply: bool) -> list[str]:
    actions: list[str] = []
    async with SessionLocal() as db:
        for spec in DEFAULT_PRIVILEGED_ACCOUNTS:
            result = await db.execute(select(User).where(User.email == spec["email"]))
            user = result.scalar_one_or_none()
            if user is None:
                actions.append(f"create {spec['email']} role={spec['role'].value}")
                if apply:
                    db.add(
                        User(
                            email=spec["email"],
                            full_name=spec["full_name"],
                            hashed_password=hash_password(spec["password"]),
                            role=spec["role"],
                            is_active=True,
                            is_deleted=False,
                        )
                    )
                continue

            changed_fields: list[str] = []
            if user.full_name != spec["full_name"]:
                changed_fields.append("full_name")
                if apply:
                    user.full_name = spec["full_name"]
            if user.role != spec["role"]:
                changed_fields.append("role")
                if apply:
                    user.role = spec["role"]
            if not user.is_active:
                changed_fields.append("is_active")
                if apply:
                    user.is_active = True
            if user.is_deleted:
                changed_fields.append("is_deleted")
                if apply:
                    user.is_deleted = False
                    user.deleted_at = None

            changed_fields.append("hashed_password")
            if apply:
                user.hashed_password = hash_password(spec["password"])

            actions.append(
                f"update {spec['email']} fields={','.join(changed_fields)}"
            )

        if apply:
            await db.commit()
        else:
            await db.rollback()

    await engine.dispose()
    return actions


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create/reset only the default privileged accounts."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write the changes. Default is dry-run.",
    )
    parser.add_argument(
        "--reason",
        required=True,
        help="Short audit reason for running the repair.",
    )
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    print(f"[repair_default_admins] reason={args.reason}", file=sys.stderr)
    actions = await repair_default_admins(apply=args.apply)
    mode = "apply" if args.apply else "dry-run"
    print(f"[repair_default_admins] mode={mode}", file=sys.stderr)
    for line in actions:
        print(f"[repair_default_admins] {line}", file=sys.stderr)
    if not args.apply:
        print(
            "[repair_default_admins] dry-run only; re-run with --apply to persist.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
