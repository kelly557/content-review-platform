"""Reorder audit_items.sort_order to match the xlsx original L1 order.

Background
----------
``import_shumei_labels.py`` applied ``sorted()`` to L1 tag names when
importing, which turned the xlsx row order (涉政→暴恐→色情→…) into
dictionary order (广告→广告法→攻击指令→…). ``mirror_tags_to_audit_rules.py``
then wrote that dictionary order into ``audit_items.sort_order`` via
``enumerate``. The left panel of the strategy editor renders items
ordered by ``sort_order``, so the user sees dictionary order instead
of the intended business order from the xlsx.

This script one-shot fixes ``audit_items.sort_order`` to match the xlsx
original L1 order for ``text_audit_pro`` and ``image_audit_pro`` packages.
It does NOT touch tags / import / mirror scripts — re-running those
without changes would reintroduce dictionary order.

Run::

    cd backend && PYTHONPATH=. ./.venv/bin/python scripts/reorder_audit_items.py --dry-run
    cd backend && PYTHONPATH=. ./.venv/bin/python scripts/reorder_audit_items.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import text

from app.db.session import SessionLocal


# xlsx 原始一级标签顺序（shumei-labels.xlsx 文本列 E / 图片列 A 首次出现顺序）
# 文本列：涉政、暴恐、色情、违禁、辱骂、广告法、广告、无意义、隐私、网络诈骗、攻击指令
# 图片列：涉政、暴恐、违禁、色情、性感、未成年人、广告、二维码、黑白名单、正常
XLSX_ORDER: dict[str, list[str]] = {
    "text_audit_pro": [
        "涉政",
        "暴恐",
        "色情",
        "违禁",
        "辱骂",
        "广告法",
        "广告",
        "无意义",
        "隐私",
        "网络诈骗",
        "攻击指令",
    ],
    "image_audit_pro": [
        "涉政",
        "暴恐",
        "违禁",
        "色情",
        "性感",
        "未成年人",
        "广告",
        "二维码",
        "黑白名单",
        "正常",
    ],
}


async def _list_items(db, package_code: str) -> list[tuple[int, str, int]]:
    """Return (id, name_cn, sort_order) for all items in a package, ordered by current sort_order."""
    rows = await db.execute(
        text(
            "SELECT id, name_cn, sort_order "
            "FROM audit_items "
            "WHERE package_code = :pkg "
            "ORDER BY sort_order ASC, id ASC"
        ),
        {"pkg": package_code},
    )
    return [(r.id, r.name_cn, r.sort_order) for r in rows]


async def _apply_reorder(db, package_code: str, order: list[str]) -> list[tuple[str, int, str]]:
    """Return planned updates: (name_cn, new_sort_order, status).

    status is "ok" if the item exists, "missing" if the xlsx name is not found in DB.
    """
    items = await _list_items(db, package_code)
    db_names = {name for _, name, _ in items}
    plan: list[tuple[str, int, str]] = []
    for idx, name in enumerate(order):
        if name in db_names:
            plan.append((name, idx, "ok"))
        else:
            plan.append((name, idx, "missing"))
    # DB 中存在但 xlsx 顺序表里没有的 item（理论上不应该出现）
    extra = db_names - set(order)
    for name in extra:
        plan.append((name, len(order), "extra"))
    return plan


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Execute UPDATE statements. Without this flag, only prints the plan (dry-run).",
    )
    args = parser.parse_args()

    async with SessionLocal() as db:
        for package_code, order in XLSX_ORDER.items():
            print(f"\n=== {package_code} ===")
            current = await _list_items(db, package_code)
            print("当前顺序 (sort_order, name_cn):")
            for _id, name, so in current:
                print(f"  {so:>3}  {name}")

            plan = await _apply_reorder(db, package_code, order)
            print("\n目标顺序 (xlsx 原始):")
            for name, idx, status in plan:
                marker = "  " if status == "ok" else "!!"
                print(f"  {marker} {idx:>3}  {name}  [{status}]")

            missing = [p for p in plan if p[2] == "missing"]
            extra = [p for p in plan if p[2] == "extra"]
            if missing:
                print(f"\n  ⚠️  xlsx 中有但 DB 无: {[p[0] for p in missing]}")
            if extra:
                print(f"  ⚠️  DB 中有但 xlsx 无（将排到末尾）: {[p[0] for p in extra]}")

            if args.apply:
                for name, idx, status in plan:
                    if status == "missing":
                        continue
                    result = await db.execute(
                        text(
                            "UPDATE audit_items "
                            "SET sort_order = :so "
                            "WHERE package_code = :pkg AND name_cn = :name"
                        ),
                        {"so": idx, "pkg": package_code, "name": name},
                    )
                    print(f"  UPDATE sort_order={idx} WHERE {package_code}.{name} → {result.rowcount} row(s)")
                await db.commit()
                print(f"  ✓ {package_code} 已提交")
            else:
                print(f"  (dry-run，未执行 UPDATE。加 --apply 落库)")

    print("\n完成。")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
