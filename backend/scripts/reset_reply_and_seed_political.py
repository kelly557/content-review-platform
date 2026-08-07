"""Reset all reply-type libraries and seed a 涉政代答库 sample.

Steps (single transaction with explicit savepoints per step):
  1. List existing reply libraries (must have 0 references in audit_point_libraries)
  2. HARD delete: library_items WHERE library_id IN (...), then libraries WHERE id IN (...)
  3. Create LibraryGroup "涉政" (sort_order=200) if not exists
  4. Create Library "涉政代答库" (code=lib_r_political, library_type=reply, group_id=<new>)
  5. Insert 6 trigger/reply pairs into library_items

Usage:
  PYTHONPATH=. python3 scripts/reset_reply_and_seed_political.py            # dry-run (default)
  PYTHONPATH=. python3 scripts/reset_reply_and_seed_political.py --agree    # actually execute
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from typing import List

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.models.audit_point_library import AuditPointLibrary
from app.models.library import Library, LibraryType
from app.models.library_group import LibraryGroup
from app.models.library_item import LibraryItem


# ─── Configuration ───────────────────────────────────────────────────

POLITICAL_GROUP_NAME = "涉政"
POLITICAL_LIB_CODE = "lib_r_political"
POLITICAL_LIB_NAME = "涉政代答库"
POLITICAL_LIB_DESC = "涉政类敏感提问的合规回复话术，触发即拒答并引导合规咨询"
POLITICAL_GROUP_SORT = 200

# (trigger, reply) pairs. 用全角竖线 ｜ 触发 _split_trigger_reply。
POLITICAL_PAIRS: List[tuple[str, str]] = [
    ("领导是谁", "亲，本平台不讨论此类话题哦"),
    ("国家领导人", "抱歉，本平台暂不支持此类咨询"),
    ("政治", "抱歉亲，暂时不提供此类内容"),
    ("政策内幕", "抱歉，无法回答此问题"),
    ("政治谣言", "抱歉亲，本平台不传播未经核实信息"),
    ("涉政新闻", "抱歉，本平台不讨论时政话题"),
]


# ─── Helpers ────────────────────────────────────────────────────────


async def _scan(db: AsyncSession) -> dict:
    """Read-only scan to assess what will be touched."""
    reply_libs = list(
        (
            await db.execute(
                select(Library).where(
                    Library.library_type == LibraryType.REPLY,
                    Library.is_deleted == False,  # noqa: E712
                )
            )
        ).scalars()
    )
    lib_ids = [l.id for l in reply_libs]

    item_count = 0
    if lib_ids:
        rows = await db.execute(
            select(LibraryItem.library_id).where(
                LibraryItem.library_id.in_(lib_ids)
            )
        )
        item_count = len(list(rows.all()))

    referenced_libs: list[tuple[int, str]] = []
    if lib_ids:
        refs = await db.execute(
            select(AuditPointLibrary.library_id, Library.code)
            .join(Library, Library.id == AuditPointLibrary.library_id)
            .where(AuditPointLibrary.library_id.in_(lib_ids))
        )
        referenced_libs = [(lid, code) for lid, code in refs.all()]

    grp = (
        await db.execute(
            select(LibraryGroup).where(LibraryGroup.name == POLITICAL_GROUP_NAME)
        )
    ).scalar_one_or_none()

    code_exists = (
        await db.execute(
            select(Library).where(Library.code == POLITICAL_LIB_CODE)
        )
    ).scalar_one_or_none()

    return {
        "reply_libs": reply_libs,
        "lib_ids": lib_ids,
        "item_count": item_count,
        "referenced_libs": referenced_libs,
        "political_group_exists": grp is not None,
        "political_group_id": grp.id if grp else None,
        "political_code_exists": code_exists is not None,
    }


def _print_dry_run(scan: dict) -> None:
    print("=" * 60, file=sys.stderr)
    print("Reply-library reset & seed: DRY-RUN", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    libs = scan["reply_libs"]
    print(f"Existing reply libraries to DELETE: {len(libs)}", file=sys.stderr)
    for l in libs:
        print(f"  - id={l.id} code={l.code} name={l.name!r}", file=sys.stderr)
    print(f"  library_items rows to DELETE: {scan['item_count']}", file=sys.stderr)

    refs = scan["referenced_libs"]
    if refs:
        print(
            f"\nFATAL: {len(refs)} reply lib(s) referenced by audit_points:",
            file=sys.stderr,
        )
        for lid, code in refs:
            print(f"  - lib_id={lid} code={code}", file=sys.stderr)
        print(
            "Aborting: must migrate references before hard delete.",
            file=sys.stderr,
        )
    else:
        print("\nReferences in audit_point_libraries: 0 (OK)", file=sys.stderr)

    if scan["political_group_exists"]:
        print(
            f"\nGroup '{POLITICAL_GROUP_NAME}' already exists: id={scan['political_group_id']}",
            file=sys.stderr,
        )
    else:
        print(
            f"\nGroup '{POLITICAL_GROUP_NAME}' does NOT exist; will be created.",
            file=sys.stderr,
        )

    if scan["political_code_exists"]:
        print(
            f"FATAL: library code {POLITICAL_LIB_CODE!r} already exists; cannot seed.",
            file=sys.stderr,
        )
    else:
        print(
            f"Library code {POLITICAL_LIB_CODE!r} available.",
            file=sys.stderr,
        )

    print(f"\nWill insert {len(POLITICAL_PAIRS)} (trigger, reply) pairs.", file=sys.stderr)
    for t, r in POLITICAL_PAIRS:
        print(f"  {t!r} -> {r!r}", file=sys.stderr)

    if refs or scan["political_code_exists"]:
        print("\nFATAL conditions detected — see above. Re-run not possible.", file=sys.stderr)
    else:
        print(
            "\nRe-run with --agree to actually perform the changes.",
            file=sys.stderr,
        )


async def _apply(db: AsyncSession) -> None:
    """Perform the reset + seed inside a single transaction."""
    lib_ids: list[int] = list(
        (
            await db.execute(
                select(Library.id).where(
                    Library.library_type == LibraryType.REPLY,
                    Library.is_deleted == False,  # noqa: E712
                )
            )
        ).scalars()
    )
    if not lib_ids:
        print("No reply libraries to delete.", file=sys.stderr)
    else:
        items_result = await db.execute(
            delete(LibraryItem).where(LibraryItem.library_id.in_(lib_ids))
        )
        print(f"Deleted {items_result.rowcount} library_items rows.", file=sys.stderr)

        libs_result = await db.execute(
            delete(Library).where(Library.id.in_(lib_ids))
        )
        print(f"Deleted {libs_result.rowcount} libraries rows.", file=sys.stderr)

    grp = (
        await db.execute(
            select(LibraryGroup).where(LibraryGroup.name == POLITICAL_GROUP_NAME)
        )
    ).scalar_one_or_none()
    if grp is None:
        grp = LibraryGroup(name=POLITICAL_GROUP_NAME, sort_order=POLITICAL_GROUP_SORT)
        db.add(grp)
        await db.flush()
        print(f"Created group '{POLITICAL_GROUP_NAME}' id={grp.id}", file=sys.stderr)
    else:
        print(f"Reusing group '{POLITICAL_GROUP_NAME}' id={grp.id}", file=sys.stderr)

    lib = Library(
        code=POLITICAL_LIB_CODE,
        name=POLITICAL_LIB_NAME,
        library_type=LibraryType.REPLY,
        group_id=grp.id,
        description=POLITICAL_LIB_DESC,
        is_active=True,
        ignored_services=[],
    )
    db.add(lib)
    try:
        await db.flush()
    except IntegrityError as e:
        raise RuntimeError(f"code {POLITICAL_LIB_CODE!r} conflict: {e.orig}") from e

    print(f"Created library id={lib.id} code={lib.code}", file=sys.stderr)

    for trigger, reply in POLITICAL_PAIRS:
        db.add(LibraryItem(library_id=lib.id, trigger=trigger, reply=reply))
    await db.flush()
    print(f"Inserted {len(POLITICAL_PAIRS)} (trigger, reply) pairs.", file=sys.stderr)

    await db.commit()
    print("\nCOMMIT OK.", file=sys.stderr)


async def run(agree: bool) -> int:
    async with SessionLocal() as db:
        scan = await _scan(db)
        _print_dry_run(scan)
        has_fatal = bool(scan["referenced_libs"]) or scan["political_code_exists"]
        if has_fatal:
            return 2
        if not agree:
            return 0
        await _apply(db)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--agree",
        action="store_true",
        help="Required confirmation for the hard-delete + seed.",
    )
    args = parser.parse_args()
    return asyncio.run(run(agree=args.agree))


if __name__ == "__main__":
    sys.exit(main())
