"""Registered Provider API — 大模型厂商级实体。

Phase 4：把 endpoint_url / api_key 从「每 model 重复」上移到 Provider。
一个 Provider 容纳多个 model，凭证共享。
"""
from __future__ import annotations

import re
import time
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.registered_model import (
    LargeModelCategory,
    RegisteredModel,
    RegisteredModelKind,
    RegisteredModelStatus,
    RegisteredProvider,
    RegisteredProviderStatus,
    ResourceCredential,
    make_provider_code,
)
from app.schemas.registered_model import (
    ProviderInitialModel,
    RegisteredProviderCreate,
    RegisteredProviderDetailOut,
    RegisteredProviderOut,
    RegisteredProviderRotateApiKey,
    RegisteredProviderUpdate,
)
from app.services.audit import write_audit
from app.services.code_generator import generate_registered_model_code
from app.services.credential_cipher import encrypt_token, mask_token
from app.services.resource_auth import require_reader, require_writer

router = APIRouter(prefix="/providers", tags=["providers"])

ALLOWED_PROVIDER_PRESET = {"openai", "anthropic", "bailian", "deepseek", "self-hosted", "custom"}
ALLOWED_LARGE_CATEGORY = {c.value for c in LargeModelCategory}

PROVIDER_PRESETS: dict[str, dict[str, Any]] = {
    "openai": {"label": "OpenAI", "endpoint": "https://api.openai.com/v1", "protocol": "openai-compatible"},
    "anthropic": {"label": "Anthropic", "endpoint": "https://api.anthropic.com/v1", "protocol": "anthropic-messages"},
    "bailian": {"label": "阿里百炼 (DashScope)", "endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1", "protocol": "openai-compatible"},
    "deepseek": {"label": "DeepSeek", "endpoint": "https://api.deepseek.com/v1", "protocol": "openai-compatible"},
    "self-hosted": {"label": "自建 / 私有部署", "endpoint": None, "protocol": "openai-compatible"},
    "custom": {"label": "自定义", "endpoint": None, "protocol": "custom"},
}


def _validate_preset(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    if s not in ALLOWED_PROVIDER_PRESET:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"非法 provider_preset: {s}")
    return s


def _validate_large_category(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    if s not in ALLOWED_LARGE_CATEGORY:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"非法 large_category: {s}")
    return s


def _infer_proto(preset: Optional[str]) -> str:
    info = PROVIDER_PRESETS.get(preset or "")
    return (info or {}).get("protocol") or "openai-compatible"


async def _find_or_create_credential(
    db: AsyncSession,
    *,
    api_key: str,
    provider_preset: Optional[str],
    user_id: Optional[int],
) -> ResourceCredential:
    """按 (provider_preset + masked_token) 复用已存在的凭证，否则新建。

    命中已存在但被另一 provider 占用：仍新建一份（保留多 provider 同 token 的可能）。
    """
    masked = mask_token(api_key)
    preset = (provider_preset or "").strip()
    existing = await db.scalar(
        select(ResourceCredential).where(
            and_(
                ResourceCredential.masked_token == masked,
                ResourceCredential.is_deleted.is_(False),
                func.coalesce(ResourceCredential.provider, "") == preset,
            )
        )
    )
    if existing is not None:
        return existing
    ciphertext = encrypt_token(api_key)
    cred = ResourceCredential(
        name=f"{preset or 'misc'}-{masked[-6:]}",
        provider=preset or None,
        ciphertext=ciphertext,
        masked_token=masked,
        metadata_json={"source": "provider_create"},
        created_by_id=user_id,
    )
    db.add(cred)
    await db.flush()
    return cred


def _provider_to_out(
    p: RegisteredProvider, model_count: int, masked_token: Optional[str]
) -> RegisteredProviderOut:
    return RegisteredProviderOut.model_validate(
        {
            "id": p.id,
            "public_id": p.public_id,
            "display_name": p.display_name,
            "description": p.description,
            "provider_preset": p.provider_preset,
            "endpoint_url": p.endpoint_url,
            "config": p.config or {},
            "credential_id": p.credential_id,
            "masked_token": masked_token,
            "credential_label": p.credential.name if p.credential_id and p.credential else None,
            "status": p.status,
            "model_count": model_count,
            "owner_id": p.owner_id,
            "created_by_id": p.created_by_id,
            "updated_by_id": p.updated_by_id,
            "created_at": p.created_at,
            "updated_at": p.updated_at,
        }
    )


async def _load_model_count(db: AsyncSession, provider_id: int) -> int:
    return int(
        await db.scalar(
            select(func.count())
            .select_from(RegisteredModel)
            .where(
                and_(
                    RegisteredModel.provider_id == provider_id,
                    RegisteredModel.is_deleted.is_(False),
                )
            )
        )
        or 0
    )


@router.get("", response_model=List[RegisteredProviderOut])
async def list_providers(
    status_filter: Optional[str] = Query(None, alias="status", description="active / archived"),
    q: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
) -> List[RegisteredProviderOut]:
    stmt = (
        select(RegisteredProvider)
        .options(selectinload(RegisteredProvider.credential))
        .order_by(RegisteredProvider.created_at.desc())
    )
    if status_filter:
        if status_filter not in {s.value for s in RegisteredProviderStatus}:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"非法 status: {status_filter}")
        stmt = stmt.where(RegisteredProvider.status == status_filter)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(RegisteredProvider.display_name.ilike(like))
    rows = (await db.execute(stmt)).scalars().all()

    # 批量取 model_count
    provider_ids = [p.id for p in rows]
    if provider_ids:
        counts = dict(
            (
                await db.execute(
                    select(RegisteredModel.provider_id, func.count())
                    .where(
                        and_(
                            RegisteredModel.provider_id.in_(provider_ids),
                            RegisteredModel.is_deleted.is_(False),
                        )
                    )
                    .group_by(RegisteredModel.provider_id)
                )
            ).all()
        )
    else:
        counts = {}

    return [
        _provider_to_out(
            p,
            counts.get(p.id, 0),
            p.credential.masked_token if p.credential_id and p.credential else None,
        )
        for p in rows
    ]


@router.get("/options", operation_id="providers_options")
async def list_provider_options(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
) -> list[dict]:
    """轻量下拉：所有 active Provider（不含 model_count 关联）。"""
    rows = (
        await db.execute(
            select(RegisteredProvider)
            .options(selectinload(RegisteredProvider.credential))
            .where(RegisteredProvider.status == RegisteredProviderStatus.ACTIVE.value)
            .order_by(RegisteredProvider.display_name.asc())
        )
    ).scalars().all()
    return [
        {
            "id": p.id,
            "display_name": p.display_name,
            "provider_preset": p.provider_preset,
            "endpoint_url": p.endpoint_url,
            "masked_token": p.credential.masked_token if p.credential_id and p.credential else None,
            "status": p.status,
        }
        for p in rows
    ]


@router.get("/{provider_id}", response_model=RegisteredProviderDetailOut)
async def get_provider(
    provider_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
) -> RegisteredProviderDetailOut:
    p = await db.scalar(
        select(RegisteredProvider)
        .options(selectinload(RegisteredProvider.credential))
        .where(RegisteredProvider.id == provider_id)
    )
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider 不存在")

    # 关联 models
    rows = (
        await db.execute(
            select(RegisteredModel)
            .where(
                and_(
                    RegisteredModel.provider_id == provider_id,
                    RegisteredModel.is_deleted.is_(False),
                )
            )
            .order_by(RegisteredModel.created_at.desc())
        )
    ).scalars().all()
    from app.schemas.registered_model import RegisteredModelListItem

    items: list[dict] = []
    for m in rows:
        items.append(
            RegisteredModelListItem.model_validate(
                {
                    "id": m.id,
                    "public_id": m.public_id,
                    "code": m.code,
                    "name": m.name,
                    "kind": m.kind,
                    "small_category": m.small_category,
                    "large_category": m.large_category,
                    "provider_id": m.provider_id,
                    "provider_preset": p.provider_preset,
                    "provider_label": p.display_name,
                    "model_name": m.model_name,
                    "max_output_tokens": m.max_output_tokens,
                    "registration_method": m.registration_method,
                    "status": m.status,
                    "version": m.version,
                    "current_version_id": m.current_version_id,
                    "current_version_no": None,
                    "owner_id": m.owner_id,
                    "created_at": m.created_at,
                    "updated_at": m.updated_at,
                }
            ).model_dump()
        )

    out = _provider_to_out(
        p,
        len(items),
        p.credential.masked_token if p.credential_id and p.credential else None,
    ).model_dump()
    out["models"] = items
    return RegisteredProviderDetailOut.model_validate(out)


@router.post("", response_model=RegisteredProviderDetailOut, status_code=status.HTTP_201_CREATED)
async def create_provider(
    body: RegisteredProviderCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> RegisteredProviderDetailOut:
    preset = _validate_preset(body.provider_preset)
    if not body.endpoint_url or not body.endpoint_url.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "endpoint_url 必填")

    # 1) 凭证：raw token 入库（仅当 present）
    cred = await _find_or_create_credential(
        db, api_key=body.api_key, provider_preset=preset, user_id=user.id
    )

    # 2) Provider 行
    config = {}
    proto = _infer_proto(preset)
    config["protocol"] = proto
    config["timeout"] = 30

    code = make_provider_code(preset)
    # 应对极端碰撞：再生成一次
    while await db.scalar(select(RegisteredProvider).where(RegisteredProvider.code == code)) is not None:
        code = make_provider_code(preset)

    provider = RegisteredProvider(
        code=code,
        display_name=body.display_name.strip(),
        description=body.description,
        provider_preset=preset,
        endpoint_url=body.endpoint_url.strip(),
        config=config,
        credential_id=cred.id,
        status=RegisteredProviderStatus.ACTIVE.value,
        owner_id=user.id,
        created_by_id=user.id,
        updated_by_id=user.id,
    )
    db.add(provider)
    await db.flush()

    # 3) 一次性创建 initial_models
    initial_summary = []
    for init in body.initial_models:
        await _create_provider_model(
            db,
            provider=provider,
            init=init,
            user=user,
        )
        initial_summary.append(init.model_name)

    await write_audit(
        db,
        actor=user,
        action="registered_provider.create",
        entity_type="registered_provider",
        entity_id=provider.id,
        payload={
            "display_name": provider.display_name,
            "provider_preset": provider.provider_preset,
            "endpoint_url": provider.endpoint_url,
            "credential_id": provider.credential_id,
            "masked_token": cred.masked_token,
            "initial_models": initial_summary,
        },
    )
    await db.commit()
    # 重新取一次（确保 status 字段是枚举）
    await db.refresh(provider, ["credential"])
    return await get_provider(provider.id, db=db, user=user)


async def _create_provider_model(
    db: AsyncSession,
    *,
    provider: RegisteredProvider,
    init: ProviderInitialModel,
    user,
) -> RegisteredModel:
    """在 Provider 下创建一个大模型；端点 / 凭证 继承自 Provider。"""
    _validate_large_category(init.large_category)
    if not init.large_category:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "大模型分类（large_category）必填：text / multimodal / other",
        )

    code = generate_registered_model_code()
    model = RegisteredModel(
        code=code,
        name=(init.name or init.model_name).strip(),
        description=init.description,
        kind=RegisteredModelKind.LARGE.value,
        small_category=None,
        large_category=init.large_category,
        provider_id=provider.id,
        model_name=init.model_name.strip(),
        max_output_tokens=None,
        registration_method="remote_api",
        status=RegisteredModelStatus.DRAFT.value,
        version=init.version,
        config=provider.config or {},
        owner_id=user.id,
        created_by_id=user.id,
        updated_by_id=user.id,
    )
    db.add(model)
    await db.flush()

    from app.models.registered_model import RegisteredModelVersion, RegisteredModelVersionStatus
    next_no = 1
    ver = RegisteredModelVersion(
        model_id=model.id,
        version_no=next_no,
        version_label=init.version or f"v{next_no}",
        notes=None,
        large_category=init.large_category,
        registration_method="remote_api",
        provider=provider.provider_preset,
        model_name=init.model_name.strip(),
        endpoint_url=provider.endpoint_url,
        config=provider.config or {},
        credential_id=provider.credential_id,
        status=RegisteredModelVersionStatus.DRAFT.value,
        created_by_id=user.id,
    )
    db.add(ver)
    await db.flush()
    model.current_version_id = ver.id
    await db.flush()
    return model


@router.patch("/{provider_id}", response_model=RegisteredProviderOut)
async def update_provider(
    provider_id: int,
    body: RegisteredProviderUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> RegisteredProviderOut:
    p = await db.scalar(
        select(RegisteredProvider)
        .options(selectinload(RegisteredProvider.credential))
        .where(RegisteredProvider.id == provider_id)
    )
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider 不存在")

    data = body.model_dump(exclude_unset=True)
    if "provider_preset" in data and data["provider_preset"]:
        data["provider_preset"] = _validate_preset(data["provider_preset"])
        # 改 preset 同步影响 config.protocol
        p.config = dict(p.config or {})
        p.config["protocol"] = _infer_proto(data["provider_preset"])
    if "endpoint_url" in data and data["endpoint_url"] is not None:
        if not data["endpoint_url"].strip():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "endpoint_url 不能为空")
    for key, val in data.items():
        setattr(p, key, val)
    p.updated_by_id = user.id
    await write_audit(
        db,
        actor=user,
        action="registered_provider.update",
        entity_type="registered_provider",
        entity_id=p.id,
        payload={"changes": {k: (data[k] if k in data else None) for k in data}},
    )
    await db.commit()
    await db.refresh(p, ["credential"])
    return _provider_to_out(p, await _load_model_count(db, p.id), p.credential.masked_token if p.credential_id and p.credential else None)


@router.post("/{provider_id}/api-key", response_model=RegisteredProviderOut)
async def rotate_api_key(
    provider_id: int,
    body: RegisteredProviderRotateApiKey,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> RegisteredProviderOut:
    """替换 Provider 的 API key：新 token 自动建凭证并切换。旧凭证随业务自然漂移。"""
    p = await db.scalar(
        select(RegisteredProvider)
        .options(selectinload(RegisteredProvider.credential))
        .where(RegisteredProvider.id == provider_id)
    )
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider 不存在")

    preset = p.provider_preset
    new_cred = await _find_or_create_credential(
        db, api_key=body.api_key, provider_preset=preset, user_id=user.id
    )
    old_credential_id = p.credential_id
    p.credential_id = new_cred.id
    p.updated_by_id = user.id
    await write_audit(
        db,
        actor=user,
        action="registered_provider.api_key.rotate",
        entity_type="registered_provider",
        entity_id=p.id,
        payload={"from_credential_id": old_credential_id, "to_credential_id": new_cred.id, "masked_token": new_cred.masked_token},
    )
    await db.commit()
    await db.refresh(p, ["credential"])
    return _provider_to_out(p, await _load_model_count(db, p.id), new_cred.masked_token)


@router.post("/{provider_id}/validate", response_model=dict)
async def validate_provider(
    provider_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> dict:
    p = await db.scalar(
        select(RegisteredProvider)
        .options(selectinload(RegisteredProvider.credential))
        .where(RegisteredProvider.id == provider_id)
    )
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider 不存在")
    if p.credential is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Provider 未绑定凭证")

    from app.services.credential_cipher import decrypt_token
    try:
        token = decrypt_token(p.credential.ciphertext)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"凭证无法解密：{exc}") from exc

    import httpx as _httpx
    proto = (p.config or {}).get("protocol") or "openai-compatible"
    headers = {"User-Agent": "adreview-provider-validator/1.0"}
    if proto in {"openai-compatible", "anthropic-messages"}:
        headers["Authorization"] = f"Bearer {token}"
    target = p.endpoint_url.rstrip("/")
    try:
        async with _httpx.AsyncClient(timeout=10) as client:
            t0 = time.perf_counter()
            resp = await client.get(target, headers=headers)
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
        ok = resp.status_code < 500
        return {
            "ok": ok,
            "http_status": resp.status_code,
            "latency_ms": elapsed_ms,
            "message": ("OK" if ok else f"HTTP {resp.status_code}")[:255],
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "http_status": None, "latency_ms": None, "message": str(exc)[:255]}


@router.post("/{provider_id}/archive", response_model=RegisteredProviderOut)
async def archive_provider(
    provider_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> RegisteredProviderOut:
    """软归档 Provider（status=archived）。前端列表不再展示，但数据保留。"""
    p = await db.scalar(
        select(RegisteredProvider)
        .options(selectinload(RegisteredProvider.credential))
        .where(RegisteredProvider.id == provider_id)
    )
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider 不存在")
    p.status = RegisteredProviderStatus.ARCHIVED.value
    p.updated_by_id = user.id
    await write_audit(
        db,
        actor=user,
        action="registered_provider.archive",
        entity_type="registered_provider",
        entity_id=p.id,
        payload={"status": p.status},
    )
    await db.commit()
    await db.refresh(p, ["credential"])
    return _provider_to_out(p, await _load_model_count(db, p.id), p.credential.masked_token if p.credential_id and p.credential else None)


@router.delete("/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(
    provider_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> None:
    """删除 Provider。若仍有模型挂载，返回 409，由前端引导用户先迁移模型或归档。"""
    p = await db.scalar(
        select(RegisteredProvider)
        .options(selectinload(RegisteredProvider.credential))
        .where(RegisteredProvider.id == provider_id)
    )
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider 不存在")

    mc = await _load_model_count(db, provider_id)
    if mc > 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"该 Provider 下存在 {mc} 个模型，无法删除。请先把模型迁至其他 Provider 或选择「归档」。",
        )

    masked = p.credential.masked_token if p.credential_id and p.credential else None
    await write_audit(
        db,
        actor=user,
        action="registered_provider.delete",
        entity_type="registered_provider",
        entity_id=p.id,
        payload={"display_name": p.display_name, "endpoint_url": p.endpoint_url, "masked_token": masked},
    )
    await db.delete(p)
    await db.commit()
    return None
