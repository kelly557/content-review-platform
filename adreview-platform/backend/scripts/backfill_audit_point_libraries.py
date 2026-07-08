"""Backfill audit_points → audit_point_libraries join table.

Copies the historical 1:1 links from three legacy columns on audit_points
into the new N:M join table:

  - custom_library_id       → libraries (expecting type=image; warn if not)
  - custom_reply_library_id → libraries (expecting type=reply; warn if not)
  - custom_wordset_id       → word_sets → libraries (via word_set.code)

The legacy columns remain in place and are **not** modified; new code no
longer writes to them. Backfill is idempotent (UNIQUE on the composite
PK makes re-runs safe).

Usage:
    python scripts/backfill_audit_point_libraries.py            # dry-run (default)
    python scripts/backfill_audit_point_libraries.py --apply    # actually insert
    python scripts/backfill_audit_point_libraries.py --apply --agree-reset  # required
                                                               # confirmation
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.models.audit_point import AuditPoint
from app.models.library import Library
from app.models.wordset import WordSet


@dataclass
class BackfillReport:
    custom_library_will_insert: int = 0
    custom_library_missing_lib_ids: list[int] = field(default_factory=list)
    custom_library_type_mismatch: list[tuple[int, int, str]] = field(default_factory=list)

    custom_reply_will_insert: int = 0
    custom_reply_missing_lib_ids: list[int] = field(default_factory=list)
    custom_reply_type_mismatch: list[tuple[int, int, str]] = field(default_factory=list)

    custom_wordset_will_insert: int = 0
    custom_wordset_unmigrated: list[tuple[int, int, str]] = field(default_factory=list)
    custom_wordset_missing_lib: list[tuple[int, int, str]] = field(default_factory=list)

    conflict_points: list[dict] = field(default_factory=list)

    total_audit_points_scanned: int = 0
    audit_points_with_new_associations: int = 0

    fatal: bool = False
    fatal_reasons: list[str] = field(default_factory=list)


async def _scan(db: AsyncSession) -> BackfillReport:
    """Read-only scan over audit_points; builds a report without writing."""
    report = BackfillReport()

    aps = list((await db.execute(select(AuditPoint))).scalars())
    report.total_audit_points_scanned = len(aps)

    library_cache: dict[int, Optional[Library]] = {}

    async def _get_lib(lid: int) -> Optional[Library]:
        if lid in library_cache:
            return library_cache[lid]
        lib = await db.get(Library, lid)
        library_cache[lid] = lib
        return lib

    for ap in aps:
        cl = ap.custom_library_id
        cw = ap.custom_wordset_id
        cr = getattr(ap, "custom_reply_library_id", None)

        filled = [v for v in (cl, cw, cr) if v is not None]
        if len(filled) > 1:
            report.conflict_points.append(
                {
                    "audit_point_id": ap.id,
                    "package_code": ap.package_code,
                    "item_id": ap.item_id,
                    "code": ap.code,
                    "custom_library_id": cl,
                    "custom_wordset_id": cw,
                    "custom_reply_library_id": cr,
                }
            )

        if cl is not None:
            lib = await _get_lib(cl)
            if lib is None:
                report.custom_library_missing_lib_ids.append(cl)
            else:
                if lib.library_type.value != "image":
                    report.custom_library_type_mismatch.append(
                        (ap.id, cl, lib.library_type.value)
                    )
                report.custom_library_will_insert += 1

        if cr is not None:
            lib = await _get_lib(cr)
            if lib is None:
                report.custom_reply_missing_lib_ids.append(cr)
            else:
                if lib.library_type.value != "reply":
                    report.custom_reply_type_mismatch.append(
                        (ap.id, cr, lib.library_type.value)
                    )
                report.custom_reply_will_insert += 1

        if cw is not None:
            ws = await db.get(WordSet, cw)
            if ws is None:
                report.custom_wordset_unmigrated.append((ap.id, cw, "wordset row not found"))
            else:
                lib = (
                    await db.execute(
                        select(Library).where(Library.code == ws.code)
                    )
                ).scalar_one_or_none()
                if lib is None:
                    report.custom_wordset_unmigrated.append(
                        (ap.id, cw, f"no library with code={ws.code}")
                    )
                else:
                    if lib.library_type.value != "word":
                        report.custom_wordset_unmigrated.append(
                            (ap.id, cw, f"library type={lib.library_type.value} (expected word)")
                        )
                    else:
                        report.custom_wordset_will_insert += 1

        if filled:
            report.audit_points_with_new_associations += 1

    return report


def _print_report(report: BackfillReport) -> None:
    print("=" * 70, file=sys.stderr)
    print("Backfill report (dry-run)", file=sys.stderr)
    print("=" * 70, file=sys.stderr)
    print(
        f"  audit_points scanned               : {report.total_audit_points_scanned}",
        file=sys.stderr,
    )
    print(
        f"  audit_points with associations     : {report.audit_points_with_new_associations}",
        file=sys.stderr,
    )
    print("", file=sys.stderr)
    print("[custom_library_id] (expected: image)", file=sys.stderr)
    print(f"  will insert                  : {report.custom_library_will_insert}", file=sys.stderr)
    print(f"  orphan lib ids (not found)   : {len(report.custom_library_missing_lib_ids)}", file=sys.stderr)
    if report.custom_library_missing_lib_ids:
        print(f"    ids: {report.custom_library_missing_lib_ids}", file=sys.stderr)
    print(
        f"  type mismatch (warn only)    : {len(report.custom_library_type_mismatch)}",
        file=sys.stderr,
    )
    for ap_id, lib_id, t in report.custom_library_type_mismatch[:10]:
        print(f"    ap={ap_id} lib={lib_id} type={t}", file=sys.stderr)
    print("", file=sys.stderr)
    print("[custom_reply_library_id] (expected: reply)", file=sys.stderr)
    print(f"  will insert                  : {report.custom_reply_will_insert}", file=sys.stderr)
    print(f"  orphan lib ids (not found)   : {len(report.custom_reply_missing_lib_ids)}", file=sys.stderr)
    if report.custom_reply_missing_lib_ids:
        print(f"    ids: {report.custom_reply_missing_lib_ids}", file=sys.stderr)
    print(
        f"  type mismatch (warn only)    : {len(report.custom_reply_type_mismatch)}",
        file=sys.stderr,
    )
    for ap_id, lib_id, t in report.custom_reply_type_mismatch[:10]:
        print(f"    ap={ap_id} lib={lib_id} type={t}", file=sys.stderr)
    print("", file=sys.stderr)
    print("[custom_wordset_id] (expected: word via word_sets.code)", file=sys.stderr)
    print(f"  will insert                  : {report.custom_wordset_will_insert}", file=sys.stderr)
    print(f"  unmigrated / missing         : {len(report.custom_wordset_unmigrated)}", file=sys.stderr)
    for ap_id, ws_id, reason in report.custom_wordset_unmigrated[:10]:
        print(f"    ap={ap_id} wordset={ws_id} reason={reason}", file=sys.stderr)
    print("", file=sys.stderr)
    print("[Conflicts: same audit_point with multiple non-null legacy cols]", file=sys.stderr)
    print(f"  conflicts                    : {len(report.conflict_points)}", file=sys.stderr)
    for c in report.conflict_points[:20]:
        print(
            f"    ap={c['audit_point_id']} code={c['code']} "
            f"pkg={c['package_code']} item={c['item_id']} "
            f"lib={c['custom_library_id']} wordset={c['custom_wordset_id']} "
            f"reply={c['custom_reply_library_id']}",
            file=sys.stderr,
        )
    print("=" * 70, file=sys.stderr)


def _evaluate_fatal(report: BackfillReport) -> None:
    reasons: list[str] = []
    if report.custom_library_missing_lib_ids:
        reasons.append(
            f"custom_library_id 指向不存在的 library: {report.custom_library_missing_lib_ids}"
        )
    if report.custom_reply_missing_lib_ids:
        reasons.append(
            f"custom_reply_library_id 指向不存在的 library: {report.custom_reply_missing_lib_ids}"
        )
    if report.custom_wordset_unmigrated:
        reasons.append(
            f"custom_wordset_id 有 {len(report.custom_wordset_unmigrated)} 条未迁移到 libraries 表"
        )
    if report.conflict_points:
        reasons.append(
            f"有 {len(report.conflict_points)} 个 audit_point 在多个旧列同时非空（冲突）"
        )

    if reasons:
        report.fatal = True
        report.fatal_reasons = reasons
        print("FATAL — backfill cannot proceed:", file=sys.stderr)
        for r in reasons:
            print(f"  - {r}", file=sys.stderr)
        print(
            "\nFix the above and re-run. You can:", file=sys.stderr,
        )
        print(
            "  1) Manually reconcile conflict points (set the unwanted legacy column to NULL on each), or",
            file=sys.stderr,
        )
        print(
            "  2) For unmigrated wordsets, run scripts/migrate_to_libraries.py first.",
            file=sys.stderr,
        )


async def _apply(db: AsyncSession) -> int:
    """Apply the backfill. Idempotent: relies on composite PK to dedupe."""
    from app.models.audit_point_library import AuditPointLibrary  # lazy import

    inserted = 0
    aps = list((await db.execute(select(AuditPoint))).scalars())
    library_cache: dict[int, Optional[Library]] = {}

    async def _get_lib(lid: int) -> Optional[Library]:
        if lid in library_cache:
            return library_cache[lid]
        lib = await db.get(Library, lid)
        library_cache[lid] = lib
        return lib

    for ap in aps:
        for source_col, value in (
            ("custom_library_id", ap.custom_library_id),
            ("custom_reply_library_id", getattr(ap, "custom_reply_library_id", None)),
        ):
            if value is None:
                continue
            lib = await _get_lib(value)
            if lib is None:
                continue
            db.add(
                AuditPointLibrary(audit_point_id=ap.id, library_id=lib.id)
            )
            inserted += 1

        if ap.custom_wordset_id is not None:
            ws = await db.get(WordSet, ap.custom_wordset_id)
            if ws is None:
                continue
            lib = (
                await db.execute(
                    select(Library).where(Library.code == ws.code)
                )
            ).scalar_one_or_none()
            if lib is None:
                continue
            db.add(
                AuditPointLibrary(audit_point_id=ap.id, library_id=lib.id)
            )
            inserted += 1

    await db.commit()
    return inserted


async def run(apply: bool) -> int:
    async with SessionLocal() as db:
        report = await _scan(db)
        _print_report(report)
        _evaluate_fatal(report)
        if report.fatal:
            return 2
        if not apply:
            print(
                "\nDry-run only. Re-run with --apply to perform the insert.",
                file=sys.stderr,
            )
            return 0

        inserted = await _apply(db)
        print(
            f"\nBackfill applied: {inserted} rows inserted into audit_point_libraries.",
            file=sys.stderr,
        )
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually perform the backfill (default: dry-run).",
    )
    parser.add_argument(
        "--agree-reset",
        action="store_true",
        help="Required confirmation for --apply.",
    )
    args = parser.parse_args()

    if args.apply and not args.agree_reset:
        print(
            "Refusing to apply without --agree-reset confirmation.",
            file=sys.stderr,
        )
        return 1

    return asyncio.run(run(apply=args.apply))


if __name__ == "__main__":
    sys.exit(main())
