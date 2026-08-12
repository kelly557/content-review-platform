"""LLM 客户端解析: 从模型注册库挑默认模型 + 解析 (base_url, api_key, model).

供在线审核 / 智能体测试 / AI 优化 / 文档解析 等场景复用, 统一走模型注册库
(registered_models + registered_providers + resource_credentials), 不依赖 .env.
"""
from __future__ import annotations

import logging
from typing import Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.registered_model import RegisteredModel, RegisteredProvider
from app.services.credential_cipher import decrypt_token

log = logging.getLogger(__name__)


async def pick_default_text_model_id(db: AsyncSession) -> Optional[int]:
    """挑注册库里第一个 active 的文本大模型 id (按 id 升序).

    供无绑定模型的通用调用 (ai_optimize / parse_doc) 使用.
    没有 active 文本大模型时返回 None.
    """
    row = await db.execute(
        select(RegisteredModel.id)
        .where(
            RegisteredModel.kind == "large",
            RegisteredModel.large_category == "text",
            RegisteredModel.status == "active",
            RegisteredModel.is_deleted.is_(False),
        )
        .order_by(RegisteredModel.id.asc())
        .limit(1)
    )
    return row.scalar_one_or_none()


async def resolve_llm_client(
    db: AsyncSession, model_id: Optional[int]
) -> Tuple[Optional[object], Optional[str], Optional[str]]:
    """根据 model_id 解析大模型 client.

    返回 (client, model_name, error):
      - model_id 为空 → 挑注册库默认文本大模型; 都没有 → (None, None, error)
      - model_id 有值 → 加载 RegisteredModel → provider endpoint + credential 解密
        → MaaSClient 注入; 解析失败 → (None, None, error)
      - 成功 → (MaaSClient, model_name, None)

    client 为 ``app.services.llm.MaaSClient`` 实例.
    """
    from app.services.llm import MaaSClient

    # model_id 为空: 挑默认
    if not model_id:
        model_id = await pick_default_text_model_id(db)
        if not model_id:
            return None, None, "未配置可用的大模型 (注册库无 active 文本大模型)"

    try:
        stmt = (
            select(RegisteredModel)
            .options(
                selectinload(RegisteredModel.provider).selectinload(
                    RegisteredProvider.credential
                ),
                selectinload(RegisteredModel.credential),
            )
            .where(RegisteredModel.id == model_id)
        )
        model = (await db.execute(stmt)).scalar_one_or_none()
        if not model or model.is_deleted:
            return None, None, f"大模型 {model_id} 不存在或已删除"
        if model.status != "active":
            return None, None, f"大模型 {model_id} 未激活 (status={model.status})"

        base_url: Optional[str] = None
        api_key: Optional[str] = None
        provider = model.provider
        if provider:
            base_url = provider.endpoint_url
            if provider.credential_id and provider.credential and not provider.credential.is_deleted:
                try:
                    api_key = decrypt_token(provider.credential.ciphertext)
                except Exception as exc:
                    return None, None, f"凭证解密失败: {exc}"
        if not base_url:
            base_url = model.endpoint_url
        if not api_key and model.credential_id and model.credential and not model.credential.is_deleted:
            try:
                api_key = decrypt_token(model.credential.ciphertext)
            except Exception as exc:
                return None, None, f"凭证解密失败: {exc}"

        if not base_url:
            return None, None, f"大模型 {model_id} 未配置接入地址"
        if not api_key:
            return None, None, f"大模型 {model_id} 未配置凭证"

        model_name = model.model_name or settings.maas_model
        return (
            MaaSClient(base_url=base_url, api_key=api_key, model=model_name),
            model_name,
            None,
        )
    except Exception as exc:
        log.warning("resolve llm client failed model_id=%s: %s", model_id, exc)
        return None, None, f"大模型解析失败: {exc}"
