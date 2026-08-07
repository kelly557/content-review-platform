"""Phase B data migration: 把 strategies 上的内容拆到 rule_sets + disposition_rules。

设计：
- 纯加法。strategies.definition / triggers.override_human_review /
  material_packages.override_human_review 一概不动，仅向新表追加行，
  并把 strategies.rule_set_id / disposition_rule_id 写回。
- 行为约定：
  - 每个 strategy 创建/复用一份 RuleSet（含 strategy_points_v2 行）
  - 每个 strategy 创建/复用一份 DispositionRule（按 fingerprint 归并）
  - 内置兜底：rs_default_0001 / dr_default_0001 永存在，scope=DEFAULT 的 strategy 用内置
  - inline override (triggers / material_packages) 仅创建一份 DispositionRule 影子记录，
    父表字段不动 —— FK RENAME 留到 PR B5

守门：
- 锁文件 /tmp/adreview.migrate.lock
- 必带 --apply 与 MIGRATE_PHASE_B_ALLOWED=YES 才写库
- 默认 dry-run，预览计划

用法：
    # 预览
    PYTHONPATH=. python3 scripts/migrate_phase_b.py --dry-run

    # 实施
    PYTHONPATH=. MIGRATE_PHASE_B_ALLOWED=YES \\
        python3 scripts/migrate_phase_b.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import fcntl
import json
import os
import sys
import traceback
from collections import defaultdict
from pathlib import Path
from typing import Any

# 让脚本目录能找到 app.*
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sqlalchemy as sa  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.exc import SQLAlchemyError  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

import app.models  # noqa: F401, E402  # 触发 model registration
from app.db.session import SessionLocal, engine  # noqa: E402
from app.models import (  # noqa: E402
    Strategy,
    StrategyPoint,
    RuleSet,
    StrategyPointV2,
    DispositionRule,
    Trigger,
    MaterialPackage,
)
from app.core.id_generator import new_public_id  # noqa: E402

# 内置兜底 code（约定见 PR B1 计划 §5）
RS_BUILTIN_CODE = "rs_default_0001"
DR_BUILTIN_CODE = "dr_default_0001"

LOCK_PATH = "/tmp/adreview.migrate.lock"


def _print_banner(allow_apply: bool, will_apply: bool) -> None:
    print("=" * 72, file=sys.stderr)
    print("  ⚠ Phase B migrate: strategy → rule_set + disposition_rule", file=sys.stderr)
    print("", file=sys.stderr)
    print(
        "  This script reads existing strategies.definition and \n"
        "  schema-legacy override_human_review JSONB, and writes\n"
        "  parallel rows into rule_sets / disposition_rules.\n"
        "  It does NOT delete or modify existing JSONB payloads.",
        file=sys.stderr,
    )
    print("", file=sys.stderr)
    print(f"  mode             : {'APPLY (will write)' if will_apply else 'dry-run (no writes)'}", file=sys.stderr)
    print(f"  env MIGRATE_PHASE_B_ALLOWED : {allow_apply!r}", file=sys.stderr)
    print("=" * 72, file=sys.stderr)


# ── Fingerprint helpers ──────────────────────────────────────────
VALID_RISK_LEVELS = ("低风险", "中风险", "高风险", "无风险", "敏感")
VALID_SENSITIVE_LEVELS = ("S0", "S1", "S2", "S3")


def disposition_fingerprint(hr: dict | None) -> str:
    if not hr:
        return "EMPTY"
    return json.dumps(
        {
            "is_enabled": bool(hr.get("is_enabled", False)),
            "risk_levels": sorted(hr.get("risk_levels") or []),
            "sensitive_levels": sorted(hr.get("sensitive_levels") or []),
            "review_rule_id": hr.get("review_rule_id"),
            "sample_ratio": hr.get("sample_ratio"),
            "auto_action_overrides": dict(
                sorted((hr.get("auto_action_overrides") or {}).items())
            ),
        },
        sort_keys=True,
        ensure_ascii=False,
        default=str,
    )


def _point_tuple(p: StrategyPoint, override: dict | None) -> tuple:
    ov = (
        (override.get(p.media_type) or {})
        .get(str(p.item_id), {})
        .get(str(p.point_id))
        or {}
    )
    mt_thr = ov.get("medium_threshold")
    ht_thr = ov.get("high_threshold")
    libs = ov.get("linked_library_ids") or []
    libs_sorted: tuple[int, ...] = tuple(sorted(int(x) for x in libs))
    return (
        p.media_type,
        p.point_id,
        bool(p.is_enabled),
        float(mt_thr) if mt_thr is not None else None,
        float(ht_thr) if ht_thr is not None else None,
        libs_sorted,
    )


def rule_set_fingerprint(
    config: dict,
    points: list[tuple],
) -> str:
    return json.dumps(
        {
            "config": dict(sorted((config or {}).items())),
            "points": sorted(points),
        },
        sort_keys=True,
        ensure_ascii=False,
        default=str,
    )


# ── Section: ensure builtins ────────────────────────────────────
async def ensure_builtin_rule_set(db: AsyncSession, dry: bool) -> int:
    rs = (
        await db.execute(select(RuleSet).where(RuleSet.code == RS_BUILTIN_CODE))
    ).scalar_one_or_none()
    if rs is None:
        rs = RuleSet(
            public_id=new_public_id(),
            code=RS_BUILTIN_CODE,
            name="默认审核规则集",
            description="Phase B 内置兜底规则集，供 scope=DEFAULT 的策略及无内容策略引用。",
            config={},
            is_builtin=True,
            is_editable=False,
        )
        if not dry:
            db.add(rs)
            await db.flush()
    return rs.id


async def ensure_builtin_disposition(db: AsyncSession, dry: bool) -> int:
    dr = (
        await db.execute(
            select(DispositionRule).where(DispositionRule.code == DR_BUILTIN_CODE)
        )
    ).scalar_one_or_none()
    if dr is None:
        dr = DispositionRule(
            public_id=new_public_id(),
            code=DR_BUILTIN_CODE,
            name="默认处置规则",
            description="Phase B 内置兜底处置规则，is_enabled=FALSE 表示机审直接出结论。",
            is_enabled=False,
            risk_levels=[],
            sensitive_levels=[],
            review_rule_id=None,
            sample_ratio=100.0,
            auto_action_overrides={},
            is_builtin=True,
            is_editable=False,
        )
        if not dry:
            db.add(dr)
            await db.flush()
    return dr.id


# ── Section: rule_sets ──────────────────────────────────────────
async def migrate_rule_sets(
    db: AsyncSession, dry: bool, builtin_id: int
) -> dict[str, Any]:
    """遍历 strategies；按 (config, points) fingerprint 复用或新建 RuleSet。"""
    cache: dict[str, int] = {}
    cache["__BUILTIN__"] = builtin_id

    strategies = (await db.execute(select(Strategy))).scalars().all()
    summary = {
        "strategies_seen": len(strategies),
        "rule_sets_reused": 0,
        "rule_sets_created": 0,
        "points_total": 0,
        "skipped_empty_to_builtin": 0,
    }

    for s in strategies:
        pts = (
            await db.execute(
                select(StrategyPoint).where(StrategyPoint.strategy_id == s.id)
            )
        ).scalars().all()

        definition = s.definition or {}
        config_keys = (
            "voice_rule_mode",
            "audio_features",
            "doc_text_mode",
            "doc_image_mode",
            "video_frame_mode",
            "video_audio_mode",
            "video_frame_interval_sec",
        )
        config = {k: definition[k] for k in config_keys if k in definition}

        override = definition.get("enabled_point_overrides") or {}
        pts_tup = [_point_tuple(p, override) for p in pts]
        fp = rule_set_fingerprint(config, pts_tup)

        if fp in cache:
            summary["rule_sets_reused"] += 1
            target_rs_id = cache[fp]
        else:
            if not pts_tup and not config:
                # 空策略（无 enabled_points + 无 config）的回退到 builtin
                target_rs_id = builtin_id
                cache[fp] = builtin_id
                summary["skipped_empty_to_builtin"] += 1
            else:
                rs = RuleSet(
                    public_id=new_public_id(),
                    code=f"rs_migrated_{s.id}",
                    name=f"{s.name} 规则集",
                    description=f"Phase B 自动从策略 #{s.id} 迁移生成。",
                    config=config,
                    is_builtin=False,
                    is_editable=True,
                )
                if not dry:
                    db.add(rs)
                    await db.flush()
                    for p, tup in zip(pts, pts_tup):
                        row = StrategyPointV2(
                            public_id=new_public_id(),
                            rule_set_id=rs.id,
                            media_type=p.media_type,
                            item_id=p.item_id,
                            point_id=p.point_id,
                            is_enabled=tup[2],
                            medium_threshold=tup[3],
                            high_threshold=tup[4],
                            linked_library_ids=list(tup[5]) if tup[5] else None,
                        )
                        db.add(row)
                    summary["points_total"] += len(pts)
                cache[fp] = rs.id
                summary["rule_sets_created"] += 1

        # 写回 strategy.rule_set_id
        if not dry:
            await db.execute(
                sa.update(Strategy)
                .where(Strategy.id == s.id)
                .values(rule_set_id=target_rs_id)
            )
        else:
            print(
                f"[dry-run] strategy #{s.id} {s.name!r} → rule_set id={target_rs_id}",
                file=sys.stderr,
            )

    return summary


# ── Section: dispositions ──────────────────────────────────────
async def migrate_dispositions(
    db: AsyncSession, dry: bool, builtin_id: int
) -> dict[str, Any]:
    cache: dict[str, int] = {"__EMPTY__": builtin_id, "__BUILTIN__": builtin_id}

    strategies = (await db.execute(select(Strategy))).scalars().all()
    summary = {
        "dispositions_reused": 0,
        "dispositions_created": 0,
        "dr_default_aliases": 0,
    }

    for s in strategies:
        hr = ((s.definition or {}).get("human_review") or None)
        fp = disposition_fingerprint(hr)
        target_id: int

        if fp == "EMPTY":
            target_id = builtin_id
            summary["dr_default_aliases"] += 1
        elif fp in cache:
            target_id = cache[fp]
            summary["dispositions_reused"] += 1
        else:
            normalized = {
                "is_enabled": bool(hr.get("is_enabled", False)),
                "risk_levels": list(hr.get("risk_levels") or []),
                "sensitive_levels": list(hr.get("sensitive_levels") or []),
                "review_rule_id": hr.get("review_rule_id"),
                "sample_ratio": (
                    hr.get("sample_ratio")
                    if hr.get("sample_ratio") is not None
                    else 100.0
                ),
                "auto_action_overrides": dict(hr.get("auto_action_overrides") or {}),
            }
            dr = DispositionRule(
                public_id=new_public_id(),
                code=f"dr_migrated_{s.id}",
                name=f"{s.name} 处置",
                description=f"Phase B 自动从策略 #{s.id} 迁移生成。",
                is_enabled=normalized["is_enabled"],
                risk_levels=normalized["risk_levels"],
                sensitive_levels=normalized["sensitive_levels"],
                review_rule_id=normalized["review_rule_id"],
                sample_ratio=normalized["sample_ratio"],
                auto_action_overrides=normalized["auto_action_overrides"],
                is_builtin=False,
                is_editable=True,
            )
            if not dry:
                db.add(dr)
                await db.flush()
            target_id = dr.id
            cache[fp] = target_id
            summary["dispositions_created"] += 1

        if not dry:
            await db.execute(
                sa.update(Strategy)
                .where(Strategy.id == s.id)
                .values(disposition_rule_id=target_id)
            )
        else:
            print(
                f"[dry-run] strategy #{s.id} {s.name!r} → disposition id={target_id}",
                file=sys.stderr,
            )

    return summary


# ── Section: inline override (option A: shadow only) ────────────
async def migrate_inline_shadow(db: AsyncSession, dry: bool) -> dict[str, Any]:
    """扫 triggers / material_packages.override_human_review (JSONB)，
    为每个非空 JSON 在 disposition_rules 创建一份影子记录。
    父表字段不动 —— RENAME 与 FK 强绑留给 PR B5。
    """
    summary: dict[str, int] = defaultdict(int)
    cache_fp: dict[str, int] = {}

    # 仅扫得着的两个源；触发器 / material_packages
    src_specs = [
        ("triggers", Trigger, "override_human_review"),
        ("material_packages", MaterialPackage, "override_human_review"),
    ]

    for src_table, ModelCls, col_name in src_specs:
        rows = (
            await db.execute(select(ModelCls))
        ).scalars().all()
        for r in rows:
            raw = getattr(r, col_name, None)
            if raw is None:
                continue
            if not isinstance(raw, dict):
                # 历史遗留非字典形态：记录但不创建影子
                summary[f"{src_table}:non_dict"] += 1
                continue
            fp = disposition_fingerprint(raw)
            if fp == "EMPTY":
                summary[f"{src_table}:empty"] += 1
                continue
            if fp in cache_fp:
                target_id = cache_fp[fp]
                summary[f"{src_table}:reused"] += 1
                # FK 字段在 PR B5 才创建；此阶段只打印
                continue
            dr = DispositionRule(
                public_id=new_public_id(),
                code=f"dr_inl_{src_table}_{r.id}",
                name=f"Inline 迁移 #{r.id} (from {src_table})",
                description=(
                    f"Phase B 影子记录，对应 {src_table}.{col_name}#{r.id} 的 inline 处置。\n"
                    "PR B5 才会把父表字段改为 override_disposition_id。"
                ),
                is_enabled=bool(raw.get("is_enabled", False)),
                risk_levels=list(raw.get("risk_levels") or []),
                sensitive_levels=list(raw.get("sensitive_levels") or []),
                review_rule_id=raw.get("review_rule_id"),
                sample_ratio=raw.get("sample_ratio") or 100.0,
                auto_action_overrides=dict(raw.get("auto_action_overrides") or {}),
                is_builtin=False,
                is_editable=True,
            )
            if not dry:
                db.add(dr)
                await db.flush()
            target_id = dr.id
            cache_fp[fp] = target_id
            summary[f"{src_table}:created"] += 1
            if dry:
                print(
                    f"[dry-run] {src_table}#{r.id} inline → disposition id={target_id}",
                    file=sys.stderr,
                )

    return dict(summary)


# ── Section: validation queries (also cheap sanity preview) ───
async def collect_validation_summary(db: AsyncSession) -> dict[str, int]:
    out: dict[str, int] = {}
    out["rule_sets"] = (
        await db.execute(sa.select(sa.func.count()).select_from(RuleSet))
    ).scalar_one()
    out["strategy_points_v2"] = (
        await db.execute(
            sa.select(sa.func.count()).select_from(StrategyPointV2)
        )
    ).scalar_one()
    out["disposition_rules"] = (
        await db.execute(
            sa.select(sa.func.count()).select_from(DispositionRule)
        )
    ).scalar_one()
    out["strategies_with_rs"] = (
        await db.execute(
            sa.select(sa.func.count())
            .select_from(Strategy)
            .where(Strategy.rule_set_id.is_not(None))
        )
    ).scalar_one()
    out["strategies_with_dr"] = (
        await db.execute(
            sa.select(sa.func.count())
            .select_from(Strategy)
            .where(Strategy.disposition_rule_id.is_not(None))
        )
    ).scalar_one()
    out["strategies_total"] = (
        await db.execute(sa.select(sa.func.count()).select_from(Strategy))
    ).scalar_one()
    out["builtin_rule_sets"] = (
        await db.execute(
            sa.select(sa.func.count())
            .select_from(RuleSet)
            .where(RuleSet.code == RS_BUILTIN_CODE)
        )
    ).scalar_one()
    out["builtin_dispositions"] = (
        await db.execute(
            sa.select(sa.func.count())
            .select_from(DispositionRule)
            .where(DispositionRule.code == DR_BUILTIN_CODE)
        )
    ).scalar_one()
    return out


# ── Main ───────────────────────────────────────────────────────
async def run_migration(dry: bool) -> dict[str, Any]:
    stats: dict[str, Any] = {"dry_run": dry, "steps": {}, "validation": {}}
    async with SessionLocal() as db:
        async with db.begin():
            # 1) ensure builtins
            builtin_rs = await ensure_builtin_rule_set(db, dry=dry)
            builtin_dr = await ensure_builtin_disposition(db, dry=dry)
            stats["steps"]["builtin_rule_set_id"] = builtin_rs
            stats["steps"]["builtin_disposition_id"] = builtin_dr

            # 2) rule_sets
            stats["steps"]["rule_sets"] = await migrate_rule_sets(
                db, dry=dry, builtin_id=builtin_rs
            )

            # 3) dispositions
            stats["steps"]["dispositions"] = await migrate_dispositions(
                db, dry=dry, builtin_id=builtin_dr
            )

            # 4) inline override shadow
            stats["steps"]["inline_shadow"] = await migrate_inline_shadow(
                db, dry=dry
            )

        # 5) validation
        async with SessionLocal() as vdb:
            stats["validation"] = await collect_validation_summary(vdb)

    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    g = parser.add_mutually_exclusive_group()
    g.add_argument(
        "--dry-run",
        action="store_true",
        help="默认；只 print 计划，不写库。",
    )
    g.add_argument(
        "--apply",
        action="store_true",
        help="真实施写库，需要同时设置环境 MIGRATE_PHASE_B_ALLOWED=YES。",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="非 TTY 模式下确认不询问。",
    )
    args = parser.parse_args()

    will_apply = bool(args.apply)
    env_allowed = os.environ.get("MIGRATE_PHASE_B_ALLOWED") == "YES"

    if will_apply and not env_allowed:
        print(
            "✗ --apply 同时必须设置 MIGRATE_PHASE_B_ALLOWED=YES",
            file=sys.stderr,
        )
        return 2

    # 锁文件 —— 飞跨多进程的串联防止
    lock_fd = open(LOCK_PATH, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(
            f"✗ 另一个 migrate_phase_b.py 已在运行（lock {LOCK_PATH} 被占用）。",
            file=sys.stderr,
        )
        return 1

    _print_banner(allow_apply=env_allowed, will_apply=will_apply)

    if will_apply and sys.stdin.isatty() and not args.yes:
        try:
            reply = input("Type 'yes' to continue: ").strip().lower()
        except EOFError:
            reply = ""
        if reply != "yes":
            print("Aborted.", file=sys.stderr)
            return 1

    # 审计：尝试最佳努力记录 ops_log，失败也不致命
    try:
        from app.core.ops_log import record_op

        record_op(
            action="scripts.migrate_phase_b.run",
            status="started",
            detail={
                "argv": sys.argv,
                "env_MIGRATE_PHASE_B_ALLOWED": env_allowed,
                "args_apply": will_apply,
                "args_dry_run": not will_apply,
            },
        )
    except Exception:
        pass

    run_status = "succeeded"
    try:
        try:
            stats = asyncio.run(run_migration(dry=not will_apply))
        except SQLAlchemyError as ex:
            run_status = "failed"
            print(f"✗ DB error: {ex}", file=sys.stderr)
            print(traceback.format_exc(), file=sys.stderr)
            return 3
        except Exception as ex:
            run_status = "failed"
            print(f"✗ Unexpected error: {ex}", file=sys.stderr)
            print(traceback.format_exc(), file=sys.stderr)
            return 4

        print(json.dumps(stats, indent=2, ensure_ascii=False))

        # DB 引擎显式 dispose（dev 友好的 asyncio 退出）
        try:
            asyncio.run(engine.dispose())
        except Exception:
            pass

        try:
            from app.core.ops_log import record_op

            record_op(
                action="scripts.migrate_phase_b.run",
                status=("dry-run" if not will_apply else "succeeded"),
                detail={
                    "argv": sys.argv,
                    "summary": stats.get("steps"),
                },
            )
        except Exception:
            pass

        return 0
    finally:
        try:
            os.unlink(LOCK_PATH)
        except FileNotFoundError:
            pass
        try:
            lock_fd.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
