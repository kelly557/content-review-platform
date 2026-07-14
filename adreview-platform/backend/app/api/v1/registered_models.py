"""Registered model API — model registry with versioning.

Phase 1: outbound HTTP only; admin/superadmin write, mlr read.
Phase 2: small models (传统 ML/深度学习) registered by file upload.
"""
from __future__ import annotations

import io
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.registered_model import (
    RegisteredModel,
    RegisteredModelKind,
    RegisteredModelRegistrationMethod,
    RegisteredModelStatus,
    RegisteredModelVersion,
    RegisteredModelVersionStatus,
    ResourceCredential,
    SmallModelCategory,
)
from app.models.user import User
from app.schemas.common import Page
from app.schemas.registered_model import (
    ArtifactUploadResponse,
    RegisteredModelCreate,
    RegisteredModelListItem,
    RegisteredModelOut,
    RegisteredModelUpdate,
    RegisteredModelValidateResult,
    RegisteredModelValidationLog,
    RegisteredModelVersionCreate,
    RegisteredModelVersionOut,
    ResourceCredentialCreate,
    ResourceCredentialOut,
)
from app.services.audit import write_audit
from app.services.code_generator import generate_registered_model_code
from app.services.credential_cipher import (
    decrypt_token,
    encrypt_token,
    mask_token,
)
from app.services.model_artifact_storage import (
    ArtifactStorageError,
    delete_artifact,
    open_artifact,
    save_artifact,
)
from app.services.resource_auth import require_reader, require_writer

router = APIRouter(prefix="/registered-models", tags=["registered-models"])

ALLOWED_STATUS = {s.value for s in RegisteredModelStatus}
ALLOWED_KIND = {k.value for k in RegisteredModelKind}
ALLOWED_SMALL_CATEGORY = {c.value for c in SmallModelCategory}
ALLOWED_PROTOCOLS = {"openai-compatible", "anthropic-messages", "custom"}
ALLOWED_VERSION_STATUS = {s.value for s in RegisteredModelVersionStatus}

PROVIDER_PRESETS: Dict[str, Dict[str, Any]] = {
    "openai": {
        "label": "OpenAI",
        "endpoint": "https://api.openai.com/v1",
        "protocol": "openai-compatible",
    },
    "anthropic": {
        "label": "Anthropic",
        "endpoint": "https://api.anthropic.com/v1",
        "protocol": "anthropic-messages",
    },
    "bailian": {
        "label": "阿里百炼 (DashScope)",
        "endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "protocol": "openai-compatible",
    },
    "deepseek": {
        "label": "DeepSeek",
        "endpoint": "https://api.deepseek.com/v1",
        "protocol": "openai-compatible",
    },
    "self-hosted": {
        "label": "自建 / 私有部署",
        "endpoint": None,
        "protocol": "openai-compatible",
    },
    "custom": {
        "label": "自定义",
        "endpoint": None,
        "protocol": "custom",
    },
}

VALIDATION_LOG_LIMIT = 20


def _validate_status(s: str | None) -> str | None:
    if s is None:
        return None
    if s not in ALLOWED_STATUS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"非法 status: {s}")
    return s


def _validate_version_status(s: str | None) -> str | None:
    if s is None:
        return None
    if s not in ALLOWED_VERSION_STATUS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"非法 version status: {s}")
    return s


def _validate_kind(s: str) -> str:
    if s not in ALLOWED_KIND:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"非法 kind: {s}（期望 large / small）",
        )
    return s


def _validate_small_category(s: str | None) -> str | None:
    if s is None:
        return None
    if s not in ALLOWED_SMALL_CATEGORY:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"非法 small_category: {s}",
        )
    return s


def _validate_provider(p: str | None) -> Optional[str]:
    if p is None:
        return None
    s = p.strip()
    if not s:
        return None
    if len(s) > 128:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "provider 过长 (≤128)")
    return s


def _coerce_provider_endpoint(
    provider: Optional[str], endpoint: Optional[str]
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    if not provider:
        return provider, endpoint, None
    preset = PROVIDER_PRESETS.get(provider)
    if preset is None:
        return provider, endpoint, None
    proto = preset.get("protocol")
    if not endpoint and preset.get("endpoint"):
        return provider, preset["endpoint"], proto
    return provider, endpoint, proto


async def _resolve_credential(
    db: AsyncSession, credential_id: int
) -> Optional[ResourceCredential]:
    return await db.scalar(
        select(ResourceCredential).where(
            and_(
                ResourceCredential.id == credential_id,
                ResourceCredential.is_deleted.is_(False),
            )
        )
    )


def _to_out(model: RegisteredModel) -> RegisteredModelOut:
    current = None
    if model.current_version:
        try:
            current = RegisteredModelVersionOut.model_validate(model.current_version)
        except Exception:
            current = None
    current_no = current.version_no if current else None
    payload = {
        "id": model.id,
        "public_id": model.public_id,
        "code": model.code,
        "name": model.name,
        "description": model.description,
        "kind": model.kind,
        "small_category": model.small_category,
        "provider": model.provider,
        "model_name": model.model_name,
        "max_output_tokens": model.max_output_tokens,
        "registration_method": model.registration_method,
        "status": model.status,
        "version": model.version,
        "endpoint_url": model.endpoint_url,
        "config": model.config or {},
        "credential_id": model.credential_id,
        "credential_label": model.credential.name if model.credential_id and model.credential else None,
        "is_deleted": model.is_deleted,
        "deleted_at": model.deleted_at,
        "owner_id": model.owner_id,
        "created_by_id": model.created_by_id,
        "updated_by_id": model.updated_by_id,
        "current_version_id": model.current_version_id,
        "current_version_no": current_no,
        "current_version": current,
        "created_at": model.created_at,
        "updated_at": model.updated_at,
    }
    return RegisteredModelOut.model_validate(payload)


def _to_list_item(model: RegisteredModel) -> RegisteredModelListItem:
    # 不在列表里触发 current_version 懒加载（测试时序交叉的 schema 缓存问题）。
    # 若需要，调用方在 select 后用 await db.refresh(..., ['current_version']) 显式加载。
    current_no = None
    payload = {
        "id": model.id,
        "public_id": model.public_id,
        "code": model.code,
        "name": model.name,
        "kind": model.kind,
        "small_category": model.small_category,
        "provider": model.provider,
        "model_name": model.model_name,
        "max_output_tokens": model.max_output_tokens,
        "registration_method": model.registration_method,
        "status": model.status,
        "version": model.version,
        "current_version_id": model.current_version_id,
        "current_version_no": current_no,
        "owner_id": model.owner_id,
        "created_at": model.created_at,
        "updated_at": model.updated_at,
    }
    return RegisteredModelListItem.model_validate(payload)


async def _next_version_no(db: AsyncSession, model_id: int) -> int:
    result = await db.scalar(
        select(func.coalesce(func.max(RegisteredModelVersion.version_no), 0)).where(
            RegisteredModelVersion.model_id == model_id
        )
    )
    return int(result or 0) + 1


async def _validate_endpoint(
    endpoint_url: str,
    protocol: str,
    model_name: str | None,
    token: str | None,
    timeout: int,
) -> RegisteredModelValidationLog:
    headers = {"User-Agent": "adreview-model-validator/1.0"}
    if token and protocol in {"openai-compatible", "anthropic-messages"}:
        headers["Authorization"] = f"Bearer {token}"
    url = endpoint_url.rstrip("/")
    target = url
    if protocol == "openai-compatible" and model_name:
        target = f"{url}/models/{model_name}" if "/models" not in url else url
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            t0 = time.perf_counter()
            resp = await client.get(target, headers=headers)
            elapsed = int((time.perf_counter() - t0) * 1000)
        ok = resp.status_code < 500
        return RegisteredModelValidationLog(
            checked_at=datetime.utcnow(),
            ok=ok,
            http_status=resp.status_code,
            latency_ms=elapsed,
            message=("OK" if ok else f"HTTP {resp.status_code}")[:255],
        )
    except Exception as exc:  # noqa: BLE001
        return RegisteredModelValidationLog(
            checked_at=datetime.utcnow(),
            ok=False,
            http_status=None,
            latency_ms=None,
            message=str(exc)[:255],
        )


@router.get("", response_model=Page[RegisteredModelListItem])
async def list_models(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    q: str | None = None,
    kind: str | None = None,
    small_category: str | None = None,
    provider: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    include_deleted: bool = False,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
) -> Page[RegisteredModelListItem]:
    base = select(RegisteredModel)
    if not include_deleted:
        base = base.where(RegisteredModel.is_deleted.is_(False))
    if kind:
        _validate_kind(kind)
        base = base.where(RegisteredModel.kind == kind)
    if small_category:
        _validate_small_category(small_category)
        base = base.where(RegisteredModel.small_category == small_category)
    if provider:
        base = base.where(RegisteredModel.provider == provider)
    if status_filter:
        _validate_status(status_filter)
        base = base.where(RegisteredModel.status == status_filter)
    if q:
        like = f"%{q}%"
        base = base.where(
            or_(
                RegisteredModel.name.ilike(like),
                RegisteredModel.code.ilike(like),
                RegisteredModel.model_name.ilike(like),
            )
        )

    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = (
        await db.execute(
            base.order_by(RegisteredModel.created_at.desc())
            .offset((page - 1) * size)
            .limit(size)
        )
    ).scalars().all()
    items = [_to_list_item(r) for r in rows]
    return Page(items=items, total=total, page=page, size=size)


@router.get("/options", operation_id="registered_models_options")
async def list_active_models(
    kind: str | None = Query(
        None,
        description="按 kind 过滤（large / small）",
    ),
    small_category: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
) -> list[dict]:
    """轻量下拉：仅返回 status='active' 且未删除的模型。"""
    stmt = select(RegisteredModel).where(
        RegisteredModel.is_deleted.is_(False),
        RegisteredModel.status == RegisteredModelStatus.ACTIVE.value,
    )
    if kind:
        _validate_kind(kind)
        stmt = stmt.where(RegisteredModel.kind == kind)
    if small_category:
        _validate_small_category(small_category)
        stmt = stmt.where(RegisteredModel.small_category == small_category)
    stmt = stmt.order_by(RegisteredModel.name.asc())
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": m.id,
            "code": m.code,
            "name": m.name,
            "kind": m.kind,
            "small_category": m.small_category,
            "provider": m.provider,
            "model_name": m.model_name,
            "status": m.status,
        }
        for m in rows
    ]


@router.post("", response_model=RegisteredModelOut, status_code=status.HTTP_201_CREATED)
async def create_model(
    body: RegisteredModelCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> RegisteredModelOut:
    kind = _validate_kind(body.kind or RegisteredModelKind.LARGE.value)
    small_category = _validate_small_category(body.small_category)
    if kind == RegisteredModelKind.SMALL.value and not small_category:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "小模型（kind=small）必须选择分类（small_category）",
        )
    if kind == RegisteredModelKind.LARGE.value and small_category:
        # 大模型忽略分类，自动置空
        small_category = None

    _validate_status(body.status or RegisteredModelStatus.DRAFT.value)

    # —— 推断 registration_method（前端不传时按 kind 决定） ——
    if body.registration_method:
        if body.registration_method not in {m.value for m in RegisteredModelRegistrationMethod}:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"非法 registration_method: {body.registration_method}",
            )
        registration_method = body.registration_method
    else:
        registration_method = (
            RegisteredModelRegistrationMethod.UPLOADED_FILE.value
            if kind == RegisteredModelKind.SMALL.value
            else RegisteredModelRegistrationMethod.REMOTE_API.value
        )

    if not body.model_name or not body.model_name.strip():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "model_name 必填（厂商返回的模型标识 / 小模型为业务标识）",
        )
    model_id_str = body.model_name.strip()
    if len(model_id_str) > 128:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "model 过长 (≤128)")

    code = body.code or generate_registered_model_code()
    if (await db.scalar(select(RegisteredModel).where(RegisteredModel.code == code))) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"编码已存在: {code}")

    # —— 小模型分支 ——
    if registration_method == RegisteredModelRegistrationMethod.UPLOADED_FILE.value:
        if body.max_output_tokens is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "小模型必须填写 max_output_tokens",
            )
        if body.max_output_tokens < 1 or body.max_output_tokens > 32768:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "max_output_tokens 必须在 1 ~ 32768 之间",
            )
        if not body.artifact or not body.artifact.storage_key:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "小模型必须先上传文件（artifact.storage_key 必填）",
            )
        # provider / endpoint_url / credential_id 在小模型分支全部忽略
        model = RegisteredModel(
            code=code,
            name=body.name,
            description=body.description,
            kind=kind,
            small_category=small_category,
            provider=None,
            model_name=model_id_str,
            max_output_tokens=body.max_output_tokens,
            registration_method=registration_method,
            status=body.status or RegisteredModelStatus.ACTIVE.value,  # 小模型无远程校验，默认 active
            version=body.version,
            endpoint_url=None,
            config={},
            credential_id=None,
            owner_id=user.id,
            created_by_id=user.id,
            updated_by_id=user.id,
        )
        db.add(model)
        await db.flush()

        version_no = await _next_version_no(db, model.id)
        art = body.artifact
        ver = RegisteredModelVersion(
            model_id=model.id,
            version_no=version_no,
            version_label=body.version or f"v{version_no}",
            registration_method=registration_method,
            provider=None,
            model_name=model_id_str,
            endpoint_url=None,
            config={},
            credential_id=None,
            artifact_storage_key=art.storage_key,
            artifact_filename=art.filename,
            artifact_mime_type=art.mime_type,
            artifact_size=art.size,
            artifact_sha256=art.sha256,
            status=RegisteredModelVersionStatus.ACTIVE.value,
            created_by_id=user.id,
        )
        db.add(ver)
        await db.flush()
        model.current_version_id = ver.id
        await db.flush()
        await db.refresh(model, ["current_version"])

        await write_audit(
            db,
            actor=user,
            action="registered_model.create",
            entity_type="registered_model",
            entity_id=model.id,
            payload={
                "code": model.code,
                "name": model.name,
                "kind": model.kind,
                "small_category": model.small_category,
                "model_name": model.model_name,
                "max_output_tokens": model.max_output_tokens,
                "registration_method": registration_method,
                "artifact_filename": art.filename,
                "artifact_size": art.size,
                "artifact_sha256": art.sha256,
                "version_no": ver.version_no,
            },
        )
        await db.commit()
        await db.refresh(model, attribute_names=["updated_at"])
        await db.refresh(model, ["current_version"])
        return _to_out(model)

    # —— 大模型 / remote_api 分支 ——
    provider = _validate_provider(body.provider)
    provider, endpoint, proto_hint = _coerce_provider_endpoint(provider, body.endpoint_url)
    if not endpoint:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "endpoint_url 必填（self-hosted / custom 需手动填写）",
        )

    config = dict(body.config or {})
    if proto_hint and "protocol" not in config:
        config["protocol"] = proto_hint
    if not config.get("protocol"):
        config["protocol"] = "openai-compatible"
    if "timeout" not in config:
        config["timeout"] = 30

    if not body.credential_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "大模型必须提供 credential_id")
    cred = await _resolve_credential(db, body.credential_id)
    if cred is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "凭证不存在或已删除")

    model = RegisteredModel(
        code=code,
        name=body.name,
        description=body.description,
        kind=kind,
        small_category=small_category,
        provider=provider,
        model_name=model_id_str,
        max_output_tokens=None,
        registration_method=registration_method,
        status=body.status or RegisteredModelStatus.DRAFT.value,
        version=body.version,
        endpoint_url=endpoint,
        config=config,
        credential_id=body.credential_id,
        owner_id=user.id,
        created_by_id=user.id,
        updated_by_id=user.id,
    )
    db.add(model)
    await db.flush()

    version_no = await _next_version_no(db, model.id)
    ver = RegisteredModelVersion(
        model_id=model.id,
        version_no=version_no,
        version_label=body.version or f"v{version_no}",
        registration_method=registration_method,
        provider=provider,
        model_name=model_id_str,
        endpoint_url=endpoint,
        config=config,
        credential_id=body.credential_id,
        status=RegisteredModelVersionStatus.DRAFT.value,
        created_by_id=user.id,
    )
    db.add(ver)
    await db.flush()
    model.current_version_id = ver.id
    await db.flush()
    await db.refresh(model, ["current_version"])

    await write_audit(
        db,
        actor=user,
        action="registered_model.create",
        entity_type="registered_model",
        entity_id=model.id,
        payload={
            "code": model.code,
            "name": model.name,
            "kind": model.kind,
            "small_category": model.small_category,
            "provider": model.provider,
            "model_name": model.model_name,
            "credential_id": model.credential_id,
            "registration_method": registration_method,
            "version_no": ver.version_no,
        },
    )
    await db.commit()
    await db.refresh(model, attribute_names=["updated_at"])
    await db.refresh(model, ["current_version"])
    return _to_out(model)


@router.get("/{model_id}", response_model=RegisteredModelOut)
async def get_model(
    model_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
) -> RegisteredModelOut:
    model = await db.scalar(
        select(RegisteredModel)
        .options(
            selectinload(RegisteredModel.credential),
            selectinload(RegisteredModel.current_version),
        )
        .where(RegisteredModel.id == model_id)
    )
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")
    return _to_out(model)


@router.patch("/{model_id}", response_model=RegisteredModelOut)
async def update_model(
    model_id: int,
    body: RegisteredModelUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> RegisteredModelOut:
    model = await db.scalar(
        select(RegisteredModel)
        .options(selectinload(RegisteredModel.current_version), selectinload(RegisteredModel.credential))
        .where(RegisteredModel.id == model_id)
    )
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")

    data = body.model_dump(exclude_unset=True)
    if "small_category" in data and data["small_category"] is not None:
        data["small_category"] = _validate_small_category(data["small_category"])
    if model.kind == RegisteredModelKind.LARGE.value and "small_category" in data:
        data["small_category"] = None
    if "status" in data and data["status"]:
        _validate_status(data["status"])
    if "provider" in data and data["provider"]:
        data["provider"] = _validate_provider(data["provider"])
    if "model_name" in data and data["model_name"]:
        if len(data["model_name"]) > 128:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "model 过长 (≤128)")
    if "credential_id" in data and data["credential_id"] is not None:
        cred = await _resolve_credential(db, data["credential_id"])
        if cred is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "凭证不存在或已删除")
    if "max_output_tokens" in data and data["max_output_tokens"] is not None:
        v = data["max_output_tokens"]
        if v < 1 or v > 32768:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "max_output_tokens 必须在 1 ~ 32768 之间",
            )
        if model.kind == RegisteredModelKind.LARGE.value:
            # 大模型不使用该字段（语义不一致），自动忽略
            data.pop("max_output_tokens")

    for k, v in data.items():
        setattr(model, k, v)
    model.updated_by_id = user.id

    await write_audit(
        db,
        actor=user,
        action="registered_model.update",
        entity_type="registered_model",
        entity_id=model.id,
        payload={"fields": sorted(data.keys())},
    )
    await db.commit()
    await db.refresh(model, attribute_names=["updated_at"])
    return _to_out(model)


@router.delete("/{model_id}")
async def delete_model(
    model_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> dict:
    model = await db.scalar(select(RegisteredModel).where(RegisteredModel.id == model_id))
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")
    model.is_deleted = True
    model.deleted_at = datetime.utcnow()
    model.updated_by_id = user.id
    await write_audit(
        db,
        actor=user,
        action="registered_model.delete",
        entity_type="registered_model",
        entity_id=model.id,
        payload={"code": model.code},
    )
    await db.commit()
    return {"id": model.id, "is_deleted": True}


# ─── Versions ───

@router.get("/{model_id}/versions", response_model=List[RegisteredModelVersionOut])
async def list_versions(
    model_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
) -> list[RegisteredModelVersionOut]:
    model = await db.scalar(select(RegisteredModel).where(RegisteredModel.id == model_id))
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")
    rows = (
        await db.execute(
            select(RegisteredModelVersion)
            .where(RegisteredModelVersion.model_id == model_id)
            .order_by(RegisteredModelVersion.version_no.desc())
        )
    ).scalars().all()
    return [RegisteredModelVersionOut.model_validate(r) for r in rows]


@router.post(
    "/{model_id}/versions",
    response_model=RegisteredModelVersionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_version(
    model_id: int,
    body: RegisteredModelVersionCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> RegisteredModelVersionOut:
    """发布新版本：版本号自增（v1, v2, ...）；如需切到新版本可再调 activate 接口。

    - 大模型（remote_api）：需要 provider / endpoint_url / credential_id（继承自当前模型或重新提供）
    - 小模型（uploaded_file）：可传 artifact 上传新权重；不传则沿用上一版本的文件
    """
    model = await db.scalar(
        select(RegisteredModel)
        .where(RegisteredModel.id == model_id)
    )
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")

    method = model.registration_method
    model_name = (body.model_name or model.model_name or "").strip()
    if not model_name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "model_name 必填")

    if method == RegisteredModelRegistrationMethod.UPLOADED_FILE.value:
        # 小模型分支：artifact 可选，不传则沿用上一版本
        # 显式加载 current_version 关系（不依赖 lazy load，避开 post_update 触发的 expire 问题）
        prev = None
        if model.current_version_id:
            prev = await db.scalar(
                select(RegisteredModelVersion).where(
                    RegisteredModelVersion.id == model.current_version_id
                )
            )
        art = body.artifact
        if art is None and prev is not None:
            # 沿用旧 artifact
            art_dict = {
                "storage_key": prev.artifact_storage_key,
                "filename": prev.artifact_filename,
                "mime_type": prev.artifact_mime_type,
                "size": prev.artifact_size,
                "sha256": prev.artifact_sha256,
            }
        elif art is not None:
            art_dict = {
                "storage_key": art.storage_key,
                "filename": art.filename,
                "mime_type": art.mime_type,
                "size": art.size,
                "sha256": art.sha256,
            }
        else:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "小模型首个版本必须上传文件",
            )
        if not art_dict.get("storage_key"):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "artifact.storage_key 缺失",
            )
        next_no = await _next_version_no(db, model.id)
        ver = RegisteredModelVersion(
            model_id=model.id,
            version_no=next_no,
            version_label=body.version_label or f"v{next_no}",
            notes=body.notes,
            registration_method=method,
            provider=None,
            model_name=model_name,
            endpoint_url=None,
            config={},
            credential_id=None,
            artifact_storage_key=art_dict["storage_key"],
            artifact_filename=art_dict["filename"],
            artifact_mime_type=art_dict["mime_type"],
            artifact_size=art_dict["size"],
            artifact_sha256=art_dict["sha256"],
            status=RegisteredModelVersionStatus.DRAFT.value,
            created_by_id=user.id,
        )
        db.add(ver)
        await db.flush()
        await write_audit(
            db,
            actor=user,
            action="registered_model.version.create",
            entity_type="registered_model_version",
            entity_id=ver.id,
            payload={
                "model_id": model.id,
                "version_no": ver.version_no,
                "version_label": ver.version_label,
                "registration_method": method,
                "artifact_filename": art_dict["filename"],
            },
        )
        await db.commit()
        await db.refresh(
            ver,
            attribute_names=[
                "id",
                "public_id",
                "model_id",
                "version_no",
                "version_label",
                "notes",
                "registration_method",
                "provider",
                "model_name",
                "endpoint_url",
                "config",
                "credential_id",
                "artifact_storage_key",
                "artifact_filename",
                "artifact_mime_type",
                "artifact_size",
                "artifact_sha256",
                "status",
                "validation_log",
                "created_by_id",
                "created_at",
            ],
        )
        return RegisteredModelVersionOut.model_validate(ver)

    # —— 大模型 / remote_api 分支 ——
    provider = _validate_provider(body.provider or model.provider)
    endpoint = body.endpoint_url or model.endpoint_url
    if not endpoint:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "endpoint_url 必填")

    config = dict(body.config or {})
    if not config.get("protocol"):
        config["protocol"] = "openai-compatible"

    credential_id = body.credential_id or model.credential_id
    if credential_id is not None:
        cred = await _resolve_credential(db, credential_id)
        if cred is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "凭证不存在或已删除")

    next_no = await _next_version_no(db, model.id)
    ver = RegisteredModelVersion(
        model_id=model.id,
        version_no=next_no,
        version_label=body.version_label or f"v{next_no}",
        notes=body.notes,
        registration_method=RegisteredModelRegistrationMethod.REMOTE_API.value,
        provider=provider,
        model_name=model_name,
        endpoint_url=endpoint,
        config=config,
        credential_id=credential_id,
        status=RegisteredModelVersionStatus.DRAFT.value,
        created_by_id=user.id,
    )
    db.add(ver)
    await db.flush()
    # 不自动切到新版本：用户可手动 activate（一个模型可能有 v1（生产）v2（测试））。
    await write_audit(
        db,
        actor=user,
        action="registered_model.version.create",
        entity_type="registered_model_version",
        entity_id=ver.id,
        payload={"model_id": model.id, "version_no": ver.version_no, "version_label": ver.version_label},
    )
    await db.commit()
    await db.refresh(ver)
    return RegisteredModelVersionOut.model_validate(ver)


@router.post(
    "/{model_id}/versions/{version_id}/activate",
    response_model=RegisteredModelVersionOut,
)
async def activate_version(
    model_id: int,
    version_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> RegisteredModelVersionOut:
    """把指定版本切到「current_version」，对应模型 status 变 active。"""
    model = await db.scalar(select(RegisteredModel).where(RegisteredModel.id == model_id))
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")
    ver = await db.scalar(
        select(RegisteredModelVersion).where(
            and_(
                RegisteredModelVersion.model_id == model_id,
                RegisteredModelVersion.id == version_id,
            )
        )
    )
    if ver is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "版本不存在")
    model.current_version_id = ver.id
    ver.status = RegisteredModelVersionStatus.ACTIVE.value
    model.status = RegisteredModelStatus.ACTIVE.value
    model.updated_by_id = user.id
    await write_audit(
        db,
        actor=user,
        action="registered_model.version.activate",
        entity_type="registered_model_version",
        entity_id=ver.id,
        payload={"model_id": model.id, "version_no": ver.version_no},
    )
    await db.commit()
    return RegisteredModelVersionOut.model_validate(ver)


# ─── Artifact 上传 / 下载（小模型权重文件） ───


@router.post(
    "/upload-artifact",
    response_model=ArtifactUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_artifact(
    file: UploadFile = File(..., description="小模型权重文件（.onnx / .pt / .pth / .bin / .zip / .tar.gz）"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> ArtifactUploadResponse:
    """上传小模型文件，返回 storage_key + sha256 等元信息，供创建/新版本时引用。

    注意：
    - 不会立刻创建 RegisteredModelVersion；调用方拿到 storage_key 后再走 POST /registered-models 或 POST /{id}/versions
    - 当前实现是本地存储（backend/storage/models/...）；后续如要换 S3 只需改 model_artifact_storage.save_artifact
    - 文件大小上限取 settings.storage_max_upload_mb（默认 512MB）
    """
    if not file.filename:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "filename 必填")
    try:
        meta = save_artifact(file.filename, file.file)
    except ArtifactStorageError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    await write_audit(
        db,
        actor=user,
        action="registered_model.artifact.upload",
        entity_type="registered_model_artifact",
        entity_id=0,  # 文件上传尚未挂载到具体模型；audit 用 0 占位
        payload={
            "filename": meta["filename"],
            "size": meta["size"],
            "sha256": meta["sha256"],
            "storage_key": meta["storage_key"],
        },
    )
    await db.commit()
    return ArtifactUploadResponse(
        storage_key=meta["storage_key"],
        filename=meta["filename"],
        mime_type=file.content_type,
        size=meta["size"],
        sha256=meta["sha256"],
    )


@router.get("/{model_id}/versions/{version_id}/artifact")
async def download_artifact(
    model_id: int,
    version_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
):
    """下载指定版本的小模型文件（流式）。"""
    ver = await db.scalar(
        select(RegisteredModelVersion).where(
            and_(
                RegisteredModelVersion.id == version_id,
                RegisteredModelVersion.model_id == model_id,
            )
        )
    )
    if ver is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "版本不存在")
    if ver.registration_method != RegisteredModelRegistrationMethod.UPLOADED_FILE.value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "该版本不是上传文件类型")
    if not ver.artifact_storage_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件未上传或已丢失")

    try:
        abs_path, filename = open_artifact(ver.artifact_storage_key)
    except ArtifactStorageError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    def _iterfile(path: "io.BufferedReader"):  # type: ignore[name-defined]
        while True:
            buf = path.read(1024 * 1024)
            if not buf:
                break
            yield buf
        path.close()

    return StreamingResponse(
        _iterfile(open(abs_path, "rb")),
        media_type=ver.artifact_mime_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{ver.artifact_filename or filename}"',
            "Content-Length": str(ver.artifact_size or abs_path.stat().st_size),
        },
    )


@router.post("/{model_id}/validate", response_model=RegisteredModelValidateResult)
async def validate_model(
    model_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> RegisteredModelValidateResult:
    model = await db.scalar(
        select(RegisteredModel)
        .where(RegisteredModel.id == model_id)
    )
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")
    if model.registration_method == RegisteredModelRegistrationMethod.UPLOADED_FILE.value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "小模型（上传文件）不支持远程连通性校验；如需确认文件请使用「下载」功能",
        )
    if not model.endpoint_url:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "缺少 endpoint_url")

    # 显式加载 current_version（post_update=True 关系与 selectinload 兼容性差）
    if model.current_version_id and model.current_version is None:
        model.current_version = await db.scalar(
            select(RegisteredModelVersion).where(
                RegisteredModelVersion.id == model.current_version_id
            )
        )

    protocol = (model.config or {}).get("protocol", "custom")
    if protocol not in ALLOWED_PROTOCOLS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"不支持的协议: {protocol}")
    timeout = int((model.config or {}).get("timeout", 30))

    token: str | None = None
    if model.credential_id:
        cred = await _resolve_credential(db, model.credential_id)
        if cred is not None:
            try:
                token = decrypt_token(cred.ciphertext)
            except ValueError:
                token = None

    log = await _validate_endpoint(model.endpoint_url, protocol, model.model_name, token, timeout)

    if model.current_version:
        history = list(model.current_version.validation_log or [])
        history.append(log)
        if len(history) > VALIDATION_LOG_LIMIT:
            history = history[-VALIDATION_LOG_LIMIT:]
        model.current_version.validation_log = history
        if log.ok:
            model.current_version.status = RegisteredModelVersionStatus.ACTIVE.value
            model.status = RegisteredModelStatus.ACTIVE.value
        else:
            model.current_version.status = RegisteredModelVersionStatus.FAILED.value
            if model.status != RegisteredModelStatus.ARCHIVED.value:
                model.status = RegisteredModelStatus.FAILED.value
    else:
        if log.ok:
            model.status = RegisteredModelStatus.ACTIVE.value
        else:
            model.status = RegisteredModelStatus.FAILED.value

    model.updated_by_id = user.id
    await write_audit(
        db,
        actor=user,
        action="registered_model.validate",
        entity_type="registered_model",
        entity_id=model.id,
        payload={
            "ok": log.ok,
            "http_status": log.http_status,
            "latency_ms": log.latency_ms,
            "message": log.message,
        },
    )
    await db.commit()
    return RegisteredModelValidateResult(ok=log.ok, log=log, status=model.status)


@router.post("/{model_id}/archive", response_model=RegisteredModelOut)
async def archive_model(
    model_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> RegisteredModelOut:
    return await _set_status(model_id, RegisteredModelStatus.ARCHIVED.value, db, user)


@router.post("/{model_id}/deactivate", response_model=RegisteredModelOut)
async def deactivate_model(
    model_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> RegisteredModelOut:
    return await _set_status(model_id, RegisteredModelStatus.INACTIVE.value, db, user)


async def _set_status(
    model_id: int,
    new_status: str,
    db: AsyncSession,
    user: User,
) -> RegisteredModelOut:
    _validate_status(new_status)
    model = await db.scalar(
        select(RegisteredModel)
        .options(selectinload(RegisteredModel.current_version), selectinload(RegisteredModel.credential))
        .where(RegisteredModel.id == model_id)
    )
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")
    prev = model.status
    model.status = new_status
    model.updated_by_id = user.id
    if model.current_version:
        model.current_version.status = new_status
    await write_audit(
        db,
        actor=user,
        action=f"registered_model.{new_status}",
        entity_type="registered_model",
        entity_id=model.id,
        payload={"prev": prev, "next": new_status},
    )
    await db.commit()
    await db.refresh(model, attribute_names=["updated_at"])
    return _to_out(model)


# ─── Credentials ───

credentials_router = APIRouter(prefix="/credentials", tags=["resource-credentials"])


@credentials_router.get("", response_model=List[ResourceCredentialOut])
async def list_credentials(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
) -> list[ResourceCredentialOut]:
    rows = (
        await db.execute(
            select(ResourceCredential)
            .where(ResourceCredential.is_deleted.is_(False))
            .order_by(ResourceCredential.created_at.desc())
        )
    ).scalars().all()
    return [ResourceCredentialOut.model_validate(r) for r in rows]


@credentials_router.post("", response_model=ResourceCredentialOut, status_code=status.HTTP_201_CREATED)
async def create_credential(
    body: ResourceCredentialCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> ResourceCredentialOut:
    ciphertext = encrypt_token(body.token)
    masked = mask_token(body.token)
    cred = ResourceCredential(
        name=body.name,
        provider=body.provider,
        ciphertext=ciphertext,
        masked_token=masked,
        metadata_json=body.metadata or {},
        created_by_id=user.id,
    )
    db.add(cred)
    await db.flush()
    await write_audit(
        db,
        actor=user,
        action="resource_credential.create",
        entity_type="resource_credential",
        entity_id=cred.id,
        payload={"name": cred.name, "provider": cred.provider, "masked_token": masked},
    )
    await db.commit()
    return ResourceCredentialOut.model_validate(cred)


@credentials_router.delete("/{credential_id}")
async def delete_credential(
    credential_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> dict:
    cred = await db.scalar(select(ResourceCredential).where(ResourceCredential.id == credential_id))
    if cred is None or cred.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "凭证不存在")
    cred.is_deleted = True
    cred.deleted_at = datetime.utcnow()
    await write_audit(
        db,
        actor=user,
        action="resource_credential.delete",
        entity_type="resource_credential",
        entity_id=cred.id,
        payload={"name": cred.name, "masked_token": cred.masked_token},
    )
    await db.commit()
    return {"id": cred.id, "is_deleted": True}
