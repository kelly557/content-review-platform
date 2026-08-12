"""幂等注册营销云 MaaS 网关下的 7 个大模型 + 清理历史 mock 模型.

复用已存在的 provider id=4 (endpoint=https://maas.marketingforce.com),
仅更新其凭证为用户提供的 token; 再 upsert 7 个真实模型 (按命名识别模态:
qwen3.7/3.8/kimi 为多模态, 其余为文本). 同时软删历史 mock 大模型
(gpt-4.6 / MiniMax-M3 / 重复的 qwen3.7) 并清理策略中对这些 mock 模型的引用.

用法:
    MAAS_API_KEY=sk-xxx PYTHONPATH=. python3 scripts/register_maas_models.py --dry-run
    MAAS_API_KEY=sk-xxx PYTHONPATH=. python3 scripts/register_maas_models.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.models.registered_model import (
    RegisteredModel,
    RegisteredProvider,
    ResourceCredential,
)
from app.models.strategy import Strategy
from app.services.credential_cipher import decrypt_token, encrypt_token, mask_token

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------

MAAS_ENDPOINT = "https://maas.marketingforce.com"
# 凭证从环境变量读取, 避免明文密钥入库.
#   MAAS_API_KEY=sk-xxx PYTHONPATH=. python3 scripts/register_maas_models.py --apply
MAAS_API_KEY = os.environ.get("MAAS_API_KEY", "")

# code → (展示名, model_name, large_category). category 按用户确认:
# qwen3.7 / qwen3.8 / kimi 为图文多模态; glm / deepseek 全系为文本.
REAL_MODELS: list[tuple[str, str, str, str]] = [
    ("maas-glm-5-2", "智谱 GLM-5.2", "glm-5.2", "text"),
    ("maas-qwen3-8-max", "通义千问 3.8 Max", "qwen3.8-max", "multimodal"),
    ("maas-deepseek-v4-flash-0731", "DeepSeek V4 Flash (0731)", "deepseek-v4-flash-0731", "text"),
    ("maas-kimi-k3", "Kimi K3", "kimi/kimi-k3", "multimodal"),
    ("maas-deepseek-v4-flash", "DeepSeek V4 Flash", "deepseek-v4-flash", "text"),
    ("maas-deepseek-v4-pro", "DeepSeek V4 Pro", "deepseek-v4-pro", "text"),
    ("maas-qwen3-7-plus", "通义千问 3.7 Plus", "qwen3.7-plus", "multimodal"),
]

# 历史 mock 大模型 model_name (跨 provider 重复 / 假名 / 占位), 软删.
MOCK_MODEL_NAMES = {"gpt-4.6", "MiniMax-M3", "qwen3.7-plus"}

# 虚假测试 provider preset+endpoint, 清理 (仅删空模型的, 不动 MaaS).
MOCK_PROVIDER_ENDPOINTS = {"https://api.openai.com/v1"}


@dataclass
class Plan:
    provider_actions: list[str]
    model_actions: list[str]
    cleanup_actions: list[str]
    strategy_actions: list[str]


async def _load_state(db: AsyncSession) -> tuple[list[RegisteredProvider], list[RegisteredModel], list[Strategy]]:
    provs = list((await db.execute(select(RegisteredProvider))).scalars().all())
    models = list(
        (await db.execute(select(RegisteredModel))).scalars().all()
    )
    strats = list((await db.execute(select(Strategy))).scalars().all())
    return provs, models, strats


def _find_maas_provider(provs: list[RegisteredProvider]) -> Optional[RegisteredProvider]:
    for p in provs:
        if p.endpoint_url == MAAS_ENDPOINT:
            return p
    return None


def _cred_matches(cred: ResourceCredential, token: str) -> bool:
    try:
        return decrypt_token(cred.ciphertext) == token
    except Exception:
        return False


def _build_plan(
    provs: list[RegisteredProvider],
    models: list[RegisteredModel],
    strats: list[Strategy],
) -> Plan:
    provider_actions: list[str] = []
    model_actions: list[str] = []
    cleanup_actions: list[str] = []
    strategy_actions: list[str] = []

    # --- Provider + 凭证 ---
    maas_prov = _find_maas_provider(provs)
    if maas_prov is None:
        provider_actions.append(f"新建 provider: endpoint={MAAS_ENDPOINT} name='营销云 MaaS 网关'")
    else:
        provider_actions.append(
            f"复用 provider id={maas_prov.id} name={maas_prov.display_name!r} endpoint={maas_prov.endpoint_url}"
        )
        # 凭证校验在 apply 阶段做 (需要 db 解密); 这里只标记意图.
        provider_actions.append("校验/更新 provider 凭证为用户提供的 token (apply 阶段判定)")

    # --- 真实模型 upsert ---
    existing_by_code: dict[str, RegisteredModel] = {
        m.code: m for m in models if not m.is_deleted
    }
    for code, name, model_name, category in REAL_MODELS:
        if code in existing_by_code:
            m = existing_by_code[code]
            changes = []
            if m.model_name != model_name:
                changes.append(f"model_name {m.model_name!r}→{model_name!r}")
            if m.large_category != category:
                changes.append(f"category {m.large_category!r}→{category!r}")
            if m.status != "active":
                changes.append(f"status {m.status!r}→'active'")
            if changes:
                model_actions.append(f"更新 model code={code} id={m.id}: {', '.join(changes)}")
            else:
                model_actions.append(f"跳过 model code={code} id={m.id} (已一致)")
        else:
            model_actions.append(f"新建 model code={code} name={name!r} model_name={model_name!r} category={category}")

    # --- mock 模型清理 ---
    mock_models = [
        m for m in models
        if (not m.is_deleted) and m.model_name in MOCK_MODEL_NAMES
        and m.code not in {c for c, _, _, _ in REAL_MODELS}  # 不删即将注册的同 model_name 真实模型
    ]
    for m in mock_models:
        cleanup_actions.append(
            f"软删 mock model id={m.id} code={m.code} name={m.name!r} model_name={m.model_name!r} "
            f"category={m.large_category} status={m.status} prov={m.provider_id}"
        )

    # --- 策略引用清理 ---
    real_codes = {c for c, _, _, _ in REAL_MODELS}
    real_model_ids = {
        m.id for m in models if (not m.is_deleted) and m.code in real_codes
    }
    mock_model_ids = {m.id for m in mock_models}
    for strat in strats:
        d = strat.definition
        if not isinstance(d, dict):
            continue
        lr = d.get("llm_review")
        if not isinstance(lr, dict):
            continue
        mid = lr.get("model_id")
        if isinstance(mid, int) and mid in mock_model_ids:
            strategy_actions.append(
                f"清理 strategy id={strat.id} name={strat.name!r} 的 llm_review.model_id={mid} (mock, 置为 None)"
            )

    return Plan(provider_actions, model_actions, cleanup_actions, strategy_actions)


async def _apply(db: AsyncSession) -> None:
    provs, models, strats = await _load_state(db)

    # 1) Provider + 凭证
    maas_prov = _find_maas_provider(provs)
    if maas_prov is None:
        maas_prov = RegisteredProvider(
            code=f"prv_maas_{_short_suffix()}",
            display_name="营销云 MaaS 网关",
            provider_preset="custom",
            endpoint_url=MAAS_ENDPOINT,
        )
        db.add(maas_prov)
        await db.flush()
        print(f"[+] 新建 provider id={maas_prov.id}")

    # 凭证: 复用或更新
    need_new_cred = True
    if maas_prov.credential_id:
        cred = await db.get(ResourceCredential, maas_prov.credential_id)
        if cred and not cred.is_deleted:
            if _cred_matches(cred, MAAS_API_KEY):
                need_new_cred = False
                print(f"[=] provider id={maas_prov.id} 凭证已匹配, 跳过")
            else:
                # 更新 ciphertext + masked
                cred.ciphertext = encrypt_token(MAAS_API_KEY)
                cred.masked_token = mask_token(MAAS_API_KEY)
                cred.provider = "maas"
                await db.flush()
                need_new_cred = False
                print(f"[~] provider id={maas_prov.id} 凭证已更新为用户 token")
    if need_new_cred:
        cred = ResourceCredential(
            name=f"maas-{mask_token(MAAS_API_KEY)[-6:]}",
            provider="maas",
            ciphertext=encrypt_token(MAAS_API_KEY),
            masked_token=mask_token(MAAS_API_KEY),
            metadata_json={"source": "register_maas_models"},
        )
        db.add(cred)
        await db.flush()
        maas_prov.credential_id = cred.id
        await db.flush()
        print(f"[+] 新建凭证 id={cred.id} 并绑定到 provider id={maas_prov.id}")

    # 2) 真实模型 upsert
    existing_by_code = {m.code: m for m in models if not m.is_deleted}
    real_codes = {c for c, _, _, _ in REAL_MODELS}
    for code, name, model_name, category in REAL_MODELS:
        if code in existing_by_code:
            m = existing_by_code[code]
            m.model_name = model_name
            m.large_category = category
            m.kind = "large"
            m.status = "active"
            m.provider_id = maas_prov.id
            m.is_deleted = False
            if not m.name:
                m.name = name
            print(f"[~] 更新 model id={m.id} code={code}")
        else:
            m = RegisteredModel(
                code=code,
                name=name,
                kind="large",
                large_category=category,
                model_name=model_name,
                provider_id=maas_prov.id,
                status="active",
            )
            db.add(m)
            await db.flush()
            print(f"[+] 新建 model id={m.id} code={code} name={name!r}")

    # 3) 软删 mock 模型
    all_models = list((await db.execute(select(RegisteredModel))).scalars().all())
    mock_targets = [
        m for m in all_models
        if (not m.is_deleted) and m.model_name in MOCK_MODEL_NAMES and m.code not in real_codes
    ]
    mock_ids = set()
    from datetime import datetime, timezone
    for m in mock_targets:
        m.is_deleted = True
        m.deleted_at = datetime.now(timezone.utc)
        if m.status == "active":
            m.status = "archived"
        mock_ids.add(m.id)
        print(f"[-] 软删 mock model id={m.id} code={m.code} name={m.name!r} model_name={m.model_name!r}")

    # 4) 清理策略引用
    for strat in (await db.execute(select(Strategy))).scalars().all():
        d = strat.definition
        if not isinstance(d, dict):
            continue
        lr = d.get("llm_review")
        if not isinstance(lr, dict):
            continue
        mid = lr.get("model_id")
        if isinstance(mid, int) and mid in mock_ids:
            lr["model_id"] = None
            lr["is_enabled"] = False
            strat.definition = dict(d)  # 触发 JSONB 变更检测
            print(f"[~] 清理 strategy id={strat.id} name={strat.name!r} 的 mock model_id={mid}")

    await db.commit()


def _short_suffix() -> str:
    import random
    import string
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=6))


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="只打印计划, 不落库")
    parser.add_argument("--apply", action="store_true", help="执行落库")
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        parser.error("需要指定 --dry-run 或 --apply")
    if not MAAS_API_KEY:
        parser.error("MAAS_API_KEY 环境变量未设置 (避免明文密钥入库, 请从环境注入)")

    async with SessionLocal() as db:
        provs, models, strats = await _load_state(db)
        plan = _build_plan(provs, models, strats)

        print("=" * 60)
        print("【Provider】")
        for a in plan.provider_actions:
            print(f"  {a}")
        print("\n【模型注册/更新】")
        for a in plan.model_actions:
            print(f"  {a}")
        print(f"\n【清理 mock 模型】({len(plan.cleanup_actions)} 条)")
        for a in plan.cleanup_actions:
            print(f"  {a}")
        print(f"\n【清理策略引用】({len(plan.strategy_actions)} 条)")
        for a in plan.strategy_actions:
            print(f"  {a}")
        print("=" * 60)

        if args.dry_run:
            print("\n[dry-run] 未落库. 加 --apply 执行.")
            return 0

        print("\n开始落库...")
        await _apply(db)
        print("落库完成.")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
