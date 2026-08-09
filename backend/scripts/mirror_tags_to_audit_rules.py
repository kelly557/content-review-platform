"""把数美三级标签体系镜像为策略规则树（审核项/审核点/sub-审核点）。

映射约定（1:1）：
  - 一级标签           → audit_items（审核项）
  - 二级标签           → audit_points（顶级审核点，parent_point_id=NULL）
  - 三级标签（含模态） → audit_points（sub-审核点，parent_point_id=父审核点）

模态 → 服务包：
  - text  → text_audit_pro
  - image → image_audit_pro

一/二级标签是跨模态共享节点：同一个一级会在 text/image 两个包各出现一行
（不同的 audit_item），其下只挂该模态有三级后代的分支。

--apply 时对 text/image 两个包执行「清空重导」：
  - 删除这两个包中 tag_id IS NULL 的旧种子审核项/审核点
    （strategy_points 等引用走 FK ON DELETE CASCADE 自动清理）
  - 按标签子树新建镜像行，code 复用标签 code（全局唯一，满足
    (package_code, code) 唯一约束），写入 tag_id 链接
  - audio / video / document / ad_compliance 四个包不动

幂等：按 (package_code, code) 查重 skip，可重复执行。

用法：
  PYTHONPATH=. python3 scripts/mirror_tags_to_audit_rules.py --dry-run
  PYTHONPATH=. python3 scripts/mirror_tags_to_audit_rules.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import sys

from sqlalchemy import delete, func, select

from app.db.session import SessionLocal
from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint, AuditPointRisk
from app.models.tag import TAG_LEVEL_LEAF, Tag

PACKAGE_BY_MODALITY = {
    "text": "text_audit_pro",
    "image": "image_audit_pro",
}

CODE_MAX = 60  # audit_items/audit_points.code 是 String(64)，留 4 字符后缀位


def _fit_code(base: str, used: set[str]) -> str:
    """code 截断到 64 以内；冲突时加 8 位 hash 后缀保证唯一。"""
    code = base[:CODE_MAX]
    if code not in used:
        used.add(code)
        return code
    digest = hashlib.md5(base.encode()).hexdigest()[:8]
    code = f"{base[: CODE_MAX - 9]}_{digest}"
    n = 2
    while code in used:
        code = f"{base[: CODE_MAX - 11]}_{digest}{n}"
        n += 1
    used.add(code)
    return code


async def _load_tag_tree(db) -> list[Tag]:
    """所有未删除标签（level 升序）。"""
    return list(
        (
            await db.execute(
                select(Tag).where(Tag.deleted_at.is_(None)).order_by(Tag.level.asc())
            )
        )
        .scalars()
        .all()
    )


def _subtree_for_modality(tags: list[Tag], modality: str):
    """按模态裁剪标签子树。

    返回 (l1_list, {l1: [l2]}, {(l1,l2): [l3]})。
    一/二级只保留「有该模态三级后代」的分支。
    """
    by_parent: dict[str | None, list[Tag]] = {}
    for t in tags:
        by_parent.setdefault(t.parent_id, []).append(t)

    l1_l2: dict[Tag, list[Tag]] = {}
    l2_l3: dict[tuple[Tag, Tag], list[Tag]] = {}
    for l1 in by_parent.get(None, []):
        for l2 in by_parent.get(l1.id, []):
            l3s = [
                t
                for t in by_parent.get(l2.id, [])
                if t.level == TAG_LEVEL_LEAF and t.modality == modality
            ]
            if l3s:
                l1_l2.setdefault(l1, []).append(l2)
                l2_l3[(l1, l2)] = l3s
    return list(l1_l2.keys()), l1_l2, l2_l3


async def run(apply: bool) -> None:
    async with SessionLocal() as db:
        tags = await _load_tag_tree(db)
        if not tags:
            print("[mirror] tags 表为空，先跑 scripts/import_shumei_labels.py")
            sys.exit(1)

        used_codes: set[str] = set()
        if not apply:
            rows = (await db.execute(select(AuditItem.package_code, AuditItem.code))).all()
            used_codes.update(f"item:{p}:{c}" for p, c in rows)
            rows = (await db.execute(select(AuditPoint.package_code, AuditPoint.code))).all()
            used_codes.update(f"point:{p}:{c}" for p, c in rows)

        for modality, pkg in PACKAGE_BY_MODALITY.items():
            l1_list, l1_l2, l2_l3 = _subtree_for_modality(tags, modality)
            n_points = sum(len(v) for v in l1_l2.values())
            n_subs = sum(len(v) for v in l2_l3.values())
            print(
                f"[mirror] {modality} → {pkg}: 审核项 {len(l1_list)} / "
                f"审核点 {n_points} / sub-审核点 {n_subs}"
            )
            if not apply:
                continue

            # 1) 清旧：删除该包 tag_id IS NULL 的旧种子（先点后项；
            #    strategy_points / strategy_items 引用走 FK CASCADE 自清）
            old_point_ids = select(AuditPoint.id).where(
                AuditPoint.package_code == pkg, AuditPoint.tag_id.is_(None)
            )
            # sub 点先删（parent CASCADE 也会处理，这里显式删两遍无害）
            await db.execute(
                delete(AuditPoint).where(
                    AuditPoint.package_code == pkg, AuditPoint.tag_id.is_(None)
                )
            )
            old_items = await db.execute(
                delete(AuditItem).where(
                    AuditItem.package_code == pkg, AuditItem.tag_id.is_(None)
                )
            )
            print(f"[mirror] {pkg} 已删除旧审核项 {old_items.rowcount or 0} 条（点级联清理）")

            # 2) 建镜像
            stats = {"item": 0, "point": 0, "sub": 0, "skip": 0}
            for sort_i, l1 in enumerate(l1_list):
                code = _fit_code(f"item:{l1.code}", used_codes).split(":", 1)[1]
                existing = await db.scalar(
                    select(AuditItem).where(
                        AuditItem.package_code == pkg, AuditItem.code == code
                    )
                )
                if existing:
                    item = existing
                    stats["skip"] += 1
                else:
                    item = AuditItem(
                        package_code=pkg,
                        code=code,
                        name_cn=l1.name[:64],
                        description=f"数美标签镜像：{l1.name}",
                        sort_order=sort_i,
                        is_enabled=True,
                        is_builtin=False,
                        tag_id=l1.id,
                    )
                    db.add(item)
                    await db.flush()
                    stats["item"] += 1

                for sort_j, l2 in enumerate(l1_l2[l1]):
                    pcode = _fit_code(f"point:{l2.code}", used_codes).split(":", 1)[1]
                    point = await db.scalar(
                        select(AuditPoint).where(
                            AuditPoint.package_code == pkg, AuditPoint.code == pcode
                        )
                    )
                    if point is None:
                        point = AuditPoint(
                            package_code=pkg,
                            item_id=item.id,
                            code=pcode,
                            label=l2.name[:128],
                            label_cn=l2.name[:64],
                            description=f"数美标签镜像：{l1.name} / {l2.name}",
                            medium_threshold=60.0,
                            high_threshold=90.0,
                            risk_level=AuditPointRisk.MEDIUM,
                            is_enabled=True,
                            is_builtin=False,
                            sort_order=sort_j,
                            tag_id=l2.id,
                        )
                        db.add(point)
                        await db.flush()
                        stats["point"] += 1
                    else:
                        stats["skip"] += 1

                    for sort_k, l3 in enumerate(l2_l3[(l1, l2)]):
                        scode = _fit_code(f"sub:{l3.code}", used_codes).split(":", 1)[1]
                        sub = await db.scalar(
                            select(AuditPoint).where(
                                AuditPoint.package_code == pkg, AuditPoint.code == scode
                            )
                        )
                        if sub is not None:
                            stats["skip"] += 1
                            continue
                        db.add(
                            AuditPoint(
                                package_code=pkg,
                                item_id=item.id,
                                code=scode,
                                label=l3.name[:128],
                                label_cn=l3.name[:64],
                                description=f"数美标签镜像：{l1.name} / {l2.name} / {l3.name}",
                                medium_threshold=60.0,
                                high_threshold=90.0,
                                risk_level=AuditPointRisk.MEDIUM,
                                is_enabled=True,
                                is_builtin=False,
                                sort_order=sort_k,
                                parent_point_id=point.id,
                                tag_id=l3.id,
                            )
                        )
                        stats["sub"] += 1
                        if stats["sub"] % 500 == 0:
                            await db.flush()
            await db.flush()
            print(
                f"[mirror] {pkg} 新建: 项 {stats['item']} / 点 {stats['point']} / "
                f"sub {stats['sub']} / 跳过 {stats['skip']}"
            )

        if apply:
            await db.commit()
            # 落库后核对
            for pkg in PACKAGE_BY_MODALITY.values():
                ni = await db.scalar(
                    select(func.count()).select_from(AuditItem).where(
                        AuditItem.package_code == pkg
                    )
                )
                np_ = await db.scalar(
                    select(func.count()).select_from(AuditPoint).where(
                        AuditPoint.package_code == pkg, AuditPoint.parent_point_id.is_(None)
                    )
                )
                ns = await db.scalar(
                    select(func.count()).select_from(AuditPoint).where(
                        AuditPoint.package_code == pkg, AuditPoint.parent_point_id.isnot(None)
                    )
                )
                print(f"[mirror] 落库核对 {pkg}: 项 {ni} / 点 {np_} / sub {ns}")
        else:
            print("[mirror] dry-run 未落库；确认无误后加 --apply")


def main() -> None:
    parser = argparse.ArgumentParser(description="数美标签镜像为策略规则树")
    parser.add_argument("--dry-run", action="store_true", help="只打印统计（默认行为）")
    parser.add_argument("--apply", action="store_true", help="实际写入（清空重导 text/image 两包）")
    args = parser.parse_args()
    asyncio.run(run(apply=args.apply))


if __name__ == "__main__":
    main()
