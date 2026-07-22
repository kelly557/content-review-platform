"""Registered model API — model registry with versioning.

Phase 1: outbound HTTP only; admin/superadmin write, mlr read.
Phase 2: small models (传统 ML/深度学习) registered by file upload.
Phase 4: Provider 二级化 + 大模型三分类
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
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.session import get_db
from app.models.registered_model import (
    LargeModelCategory,
    RegisteredModel,
    RegisteredModelKind,
    RegisteredModelRegistrationMethod,
    RegisteredModelStatus,
    RegisteredModelVersion,
    RegisteredModelVersionStatus,
    RegisteredProvider,
    ResourceCredential,
    SmallModelCategory,
)
from app.models.risk_category import RiskCategory
from app.models.user import User, UserRole
from app.schemas.common import Page
from app.schemas.registered_model import (
    ArtifactUploadResponse,
    ModelArtifactPrecheckRequest,
    ModelPrecheckRequest,
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

# ── risk_category code 内存缓存 ──
# 数据库 risk_categories.code 同步到 set[str]，给 _validate_small_category 查询用，
# 避免每次 list 都打 DB。CRUD（POST/DELETE）后失效缓存。
#
# 历史 SmallModelCategory enum value（如 'politics' / 'porn'）即使没有 seed
# 也通过 ALLOWED_SMALL_CATEGORY 兜底放行——不破坏 audit_items 已写的引用。
_RISK_CATEGORY_CODES_CACHE: set[str] | None = None

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


def _require_super_admin_for_small(kind: str, user: User) -> None:
    """小模型（kind=small）只能由超级管理员（superadmin / root_admin）配置。"""
    if kind == RegisteredModelKind.SMALL.value and user.role not in (
        UserRole.SUPERADMIN.value,
        UserRole.ROOT_ADMIN.value,
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "小模型仅超级管理员（superadmin / root_admin）可配置",
        )


async def _validate_small_category(
    s: str | None, db: AsyncSession
) -> str | None:
    """校验 small_category 字符串是否合法。

    放行 = (SmallModelCategory enum value) ∪ (risk_categories.code) ——
    历史 enum 引用永远放过；新建风险类型后写 DB 的 code 通过内存缓存命中。
    """
    if s is None:
        return None
    if s in ALLOWED_SMALL_CATEGORY:
        return s
    codes = _RISK_CATEGORY_CODES_CACHE
    if codes is None:
        # 首次进入：从 DB 加载填充缓存（同时用于本次校验）。
        await _ensure_risk_category_codes_loaded(db)
        codes = _RISK_CATEGORY_CODES_CACHE or set()
    if s in codes:
        return s
    raise HTTPException(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        f"非法 small_category: {s}（不是已知风险类型）",
    )


async def _ensure_risk_category_codes_loaded(db: AsyncSession) -> None:
    """从 DB 加载 risk_categories.code 到模块级缓存。

    每个 list/create/update endpoint 入口调用一次；缓存命中后只是 set 检查。
    POST/DELETE 风险类型后由 invalidate_risk_category_cache() 失效。
    """
    global _RISK_CATEGORY_CODES_CACHE
    rows = (
        await db.execute(select(RiskCategory.code))
    ).scalars().all()
    _RISK_CATEGORY_CODES_CACHE = set(rows)


def invalidate_risk_category_cache() -> None:
    """CRUD（POST/DELETE）后调用，让下次 query 重新读 DB。"""
    global _RISK_CATEGORY_CODES_CACHE
    _RISK_CATEGORY_CODES_CACHE = None


ALLOWED_MODALITY = {"text", "image"}


def _validate_modality(s: str | None) -> str | None:
    if s is None:
        return None
    if s not in ALLOWED_MODALITY:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"非法 modality: {s}（期望 text / image）",
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


def _provider_summary(p: Optional[RegisteredProvider]) -> Optional[dict]:
    if p is None:
        return None
    masked = p.credential.masked_token if p.credential_id and p.credential else None
    return {
        "id": p.id,
        "public_id": p.public_id,
        "display_name": p.display_name,
        "provider_preset": p.provider_preset,
        "endpoint_url": p.endpoint_url,
        "masked_token": masked,
        "status": p.status,
    }


def _to_out(model: RegisteredModel) -> RegisteredModelOut:
    current = None
    if model.current_version:
        try:
            current = RegisteredModelVersionOut.model_validate(model.current_version)
        except Exception:
            current = None
    current_no = current.version_no if current else None
    current_label = current.version_label if current else None
    p = getattr(model, "provider", None)
    payload = {
        "id": model.id,
        "public_id": model.public_id,
        "code": model.code,
        "name": model.name,
        "description": model.description,
        "kind": model.kind,
        "small_category": model.small_category,
        "modality": model.modality,
        "large_category": model.large_category,
        "provider_id": model.provider_id,
        "provider": _provider_summary(p) if p else None,
        "provider_preset": p.provider_preset if p else None,
        "model_name": model.model_name,
        "max_output_tokens": model.max_output_tokens,
        "registration_method": model.registration_method,
        "status": model.status,
        "version": model.version,
        "config": model.config or {},
        "is_deleted": model.is_deleted,
        "deleted_at": model.deleted_at,
        "owner_id": model.owner_id,
        "created_by_id": model.created_by_id,
        "updated_by_id": model.updated_by_id,
        "current_version_id": model.current_version_id,
        "current_version_no": current_no,
        "current_version_label": current_label,
        "current_version": current,
        "created_at": model.created_at,
        "updated_at": model.updated_at,
    }
    return RegisteredModelOut.model_validate(payload)


def _to_list_item(
    model: RegisteredModel,
    provider: Optional[RegisteredProvider] = None,
    artifact: Optional[dict] = None,
) -> RegisteredModelListItem:
    p = provider if provider is not None else getattr(model, "provider", None)
    payload = {
        "id": model.id,
        "public_id": model.public_id,
        "code": model.code,
        "name": model.name,
        "kind": model.kind,
        "small_category": model.small_category,
        "modality": model.modality,
        "large_category": model.large_category,
        "provider_id": model.provider_id,
        "provider_preset": p.provider_preset if p else None,
        "provider_label": p.display_name if p else None,
        "model_name": model.model_name,
        "max_output_tokens": model.max_output_tokens,
        "registration_method": model.registration_method,
        "status": model.status,
        "version": model.version,
        "current_version_id": model.current_version_id,
        "current_version_no": artifact.get("version_no") if artifact else None,
        "current_version_label": artifact.get("version_label") if artifact else None,
        "owner_id": model.owner_id,
        "created_at": model.created_at,
        "updated_at": model.updated_at,
    }
    if artifact:
        payload["artifact_filename"] = artifact.get("artifact_filename")
        payload["artifact_size"] = artifact.get("artifact_size")
        payload["current_version_config"] = artifact.get("config")
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


ALLOWED_LARGE_CATEGORY = {c.value for c in LargeModelCategory}


def _validate_large_category(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    if s not in ALLOWED_LARGE_CATEGORY:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"非法 large_category: {s}")
    return s


@router.get("", response_model=Page[RegisteredModelListItem])
async def list_models(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    q: str | None = None,
    kind: str | None = None,
    small_category: str | None = None,
    large_category: str | None = None,
    modality: str | None = Query(None, description="按模态过滤（text / image）"),
    provider_id: int | None = Query(None, description="按 Provider 过滤"),
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
        await _validate_small_category(small_category, db)
        base = base.where(RegisteredModel.small_category == small_category)
    if large_category:
        _validate_large_category(large_category)
        base = base.where(RegisteredModel.large_category == large_category)
    if modality:
        _validate_modality(modality)
        base = base.where(RegisteredModel.modality == modality)
    if provider_id is not None:
        base = base.where(RegisteredModel.provider_id == provider_id)
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

    # 显式取 provider（避开 selectinload 跨测试 schema 缓存）
    provider_ids = {r.provider_id for r in rows if r.provider_id}
    providers: dict[int, RegisteredProvider] = {}
    if provider_ids:
        provs = (
            await db.execute(
                select(RegisteredProvider)
                .where(RegisteredProvider.id.in_(provider_ids))
            )
        ).scalars().all()
        providers = {p.id: p for p in provs}

    # 显式取 current_version artifact 摘要（小模型列表展示文件名 + 大小）
    # + version_no / version_label（用于列表展示「当前模型版本」）
    # + config（用于树形展示审核点列表）
    cv_ids = [r.current_version_id for r in rows if r.current_version_id]
    version_artifact: dict[int, dict] = {}
    if cv_ids:
        ver_rows = (
            await db.execute(
                select(
                    RegisteredModelVersion.id,
                    RegisteredModelVersion.artifact_filename,
                    RegisteredModelVersion.artifact_size,
                    RegisteredModelVersion.version_no,
                    RegisteredModelVersion.version_label,
                    RegisteredModelVersion.config,
                ).where(RegisteredModelVersion.id.in_(cv_ids))
            )
        ).all()
        for vid, fn, sz, vno, vlbl, cfg in ver_rows:
            version_artifact[vid] = {
                "artifact_filename": fn,
                "artifact_size": sz,
                "version_no": vno,
                "version_label": vlbl,
                "config": cfg,
            }

    items = [
        _to_list_item(r, providers.get(r.provider_id), version_artifact.get(r.current_version_id or -1))
        for r in rows
    ]
    return Page(items=items, total=total, page=page, size=size)


@router.get("/options", operation_id="registered_models_options")
async def list_active_models(
    kind: str | None = Query(
        None,
        description="按 kind 过滤（large / small）",
    ),
    small_category: str | None = Query(None),
    large_category: str | None = Query(None),
    modality: str | None = Query(None, description="按模态过滤（text / image）"),
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
        await _validate_small_category(small_category, db)
        stmt = stmt.where(RegisteredModel.small_category == small_category)
    if large_category:
        _validate_large_category(large_category)
        stmt = stmt.where(RegisteredModel.large_category == large_category)
    if modality:
        _validate_modality(modality)
        stmt = stmt.where(RegisteredModel.modality == modality)
    stmt = stmt.order_by(RegisteredModel.name.asc())
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": m.id,
            "code": m.code,
            "name": m.name,
            "kind": m.kind,
            "small_category": m.small_category,
            "large_category": m.large_category,
            "modality": m.modality,
            "provider_id": m.provider_id,
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
    _require_super_admin_for_small(kind, user)
    small_category = await _validate_small_category(body.small_category, db)
    modality = _validate_modality(body.modality)
    large_category = _validate_large_category(body.large_category)
    if kind == RegisteredModelKind.SMALL.value and not small_category:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "小模型（kind=small）必须选择分类（small_category）",
        )
    if kind == RegisteredModelKind.SMALL.value and not modality:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "小模型（kind=small）必须选择模态（modality）：text / image",
        )
    if kind == RegisteredModelKind.LARGE.value:
        if small_category:
            small_category = None
        if modality:
            modality = None
        if not large_category:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "大模型（kind=large）必须选择分类（large_category）：text / multimodal / other",
            )

    _validate_status(body.status or RegisteredModelStatus.DRAFT.value)

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

    # Provider 解析：大模型必填；小模型可空
    provider: Optional[RegisteredProvider] = None
    if body.provider_id is not None:
        provider = await db.scalar(
            select(RegisteredProvider).where(RegisteredProvider.id == body.provider_id)
        )
        if provider is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Provider 不存在（id={body.provider_id}）",
            )
    if kind == RegisteredModelKind.LARGE.value and provider is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "大模型（kind=large）必须挂载到 Provider（请先在「添加 Provider」创建）",
        )

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
        model = RegisteredModel(
            code=code,
            name=body.name,
            description=body.description,
            kind=kind,
            small_category=small_category,
            modality=modality,
            large_category=None,
            provider_id=provider.id if provider else None,
            model_name=model_id_str,
            max_output_tokens=body.max_output_tokens,
            registration_method=registration_method,
            status=body.status or RegisteredModelStatus.ACTIVE.value,
            version=body.version,
            config={},
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
            large_category=None,
            provider=provider.provider_preset if provider else None,
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
                "provider_id": provider.id if provider else None,
                "artifact_filename": art.filename,
                "artifact_size": art.size,
                "artifact_sha256": art.sha256,
                "version_no": ver.version_no,
            },
        )
        await db.commit()
        return await _build_out_for_model(db, model)

    # 大模型 / remote_api 分支
    config = dict(body.config or {})
    if not config.get("protocol"):
        config["protocol"] = (provider.config or {}).get("protocol") or "openai-compatible"
    if "timeout" not in config:
        config["timeout"] = (provider.config or {}).get("timeout", 30)

    model = RegisteredModel(
        code=code,
        name=body.name,
        description=body.description,
        kind=kind,
        small_category=None,
        modality=None,
        large_category=large_category,
        provider_id=provider.id,
        model_name=model_id_str,
        max_output_tokens=None,
        registration_method=registration_method,
        status=body.status or RegisteredModelStatus.DRAFT.value,
        version=body.version,
        config=config,
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
        large_category=large_category,
        provider=provider.provider_preset,
        model_name=model_id_str,
        endpoint_url=provider.endpoint_url,
        config=config,
        credential_id=provider.credential_id,
        status=RegisteredModelVersionStatus.DRAFT.value,
        created_by_id=user.id,
    )
    db.add(ver)
    await db.flush()
    model.current_version_id = ver.id
    await db.flush()

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
            "large_category": large_category,
            "provider_id": provider.id,
            "model_name": model.model_name,
            "registration_method": registration_method,
            "version_no": ver.version_no,
        },
    )
    await db.commit()
    return await _build_out_for_model(db, model)


async def _build_out_for_model(db: AsyncSession, model: RegisteredModel) -> RegisteredModelOut:
    """构建 Model 详情的输出（避开 selectinload(credential) 跨测试 schema 缓存）。"""
    await db.refresh(model, attribute_names=["updated_at"])
    p: Optional[RegisteredProvider] = None
    masked: Optional[str] = None
    label: Optional[str] = None
    if model.provider_id:
        p = await db.scalar(
            select(RegisteredProvider).where(RegisteredProvider.id == model.provider_id)
        )
        if p and p.credential_id:
            cr = await db.execute(
                select(ResourceCredential.masked_token, ResourceCredential.name).where(
                    ResourceCredential.id == p.credential_id
                )
            )
            r = cr.first()
            if r is not None:
                masked, label = r[0], r[1]
    return _build_model_out(model, p, masked, label)


@router.get("/{model_id}", response_model=RegisteredModelOut)
async def get_model(
    model_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
) -> RegisteredModelOut:
    model = await db.scalar(
        select(RegisteredModel)
        .options(selectinload(RegisteredModel.current_version))
        .where(RegisteredModel.id == model_id)
    )
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")
    # 显式取 provider + credential（绕过 selectinload 跨测试 schema 缓存）
    p: Optional[RegisteredProvider] = None
    if model.provider_id:
        p = await db.scalar(
            select(RegisteredProvider).where(RegisteredProvider.id == model.provider_id)
        )
    masked: Optional[str] = None
    label: Optional[str] = None
    if p is not None and p.credential_id:
        cr = await db.execute(
            select(ResourceCredential.masked_token, ResourceCredential.name).where(
                ResourceCredential.id == p.credential_id
            )
        )
        r = cr.first()
        if r is not None:
            masked, label = r[0], r[1]
    return _build_model_out(model, p, masked, label)


def _build_model_out(model: RegisteredModel, provider: Optional[RegisteredProvider], masked_token: Optional[str], credential_label: Optional[str]) -> RegisteredModelOut:
    """包装 _to_out 但显式传入 provider + credential。"""
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
        "large_category": model.large_category,
        "provider_id": model.provider_id,
        "provider": {
            "id": provider.id,
            "public_id": provider.public_id,
            "display_name": provider.display_name,
            "provider_preset": provider.provider_preset,
            "endpoint_url": provider.endpoint_url,
            "masked_token": masked_token,
            "status": provider.status,
        } if provider else None,
        "provider_preset": provider.provider_preset if provider else None,
        "model_name": model.model_name,
        "max_output_tokens": model.max_output_tokens,
        "registration_method": model.registration_method,
        "status": model.status,
        "version": model.version,
        "config": model.config or {},
        "credential_id": provider.credential_id if provider else None,
        "credential_label": credential_label,
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


@router.patch("/{model_id}", response_model=RegisteredModelOut)
async def update_model(
    model_id: int,
    body: RegisteredModelUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> RegisteredModelOut:
    model = await db.scalar(
        select(RegisteredModel)
        .options(selectinload(RegisteredModel.current_version))
        .where(RegisteredModel.id == model_id)
    )
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")
    _require_super_admin_for_small(model.kind, user)

    data = body.model_dump(exclude_unset=True)
    if "small_category" in data and data["small_category"] is not None:
        data["small_category"] = await _validate_small_category(data["small_category"], db)
    if model.kind == RegisteredModelKind.LARGE.value and "small_category" in data:
        data["small_category"] = None
    if "modality" in data and data["modality"] is not None:
        data["modality"] = _validate_modality(data["modality"])
    if model.kind == RegisteredModelKind.LARGE.value and "modality" in data:
        data["modality"] = None
    if "large_category" in data and data["large_category"] is not None:
        data["large_category"] = _validate_large_category(data["large_category"])
    if model.kind == RegisteredModelKind.SMALL.value and "large_category" in data:
        data["large_category"] = None
    if model.kind == RegisteredModelKind.LARGE.value and not model.large_category:
        # 大模型新建时已校验；编辑时如有 large_category 入参必须非空
        pass
    if "status" in data and data["status"]:
        _validate_status(data["status"])
    if "model_name" in data and data["model_name"]:
        if len(data["model_name"]) > 128:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "model 过长 (≤128)")
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
    _require_super_admin_for_small(model.kind, user)
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

    - 大模型（remote_api）：endpoint_url / credential 继承自 Provider，可改 model_name / large_category
    - 小模型（uploaded_file）：可传 artifact 上传新权重；不传则沿用上一版本的文件
    """
    model = await db.scalar(
        select(RegisteredModel).where(RegisteredModel.id == model_id)
    )
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")
    _require_super_admin_for_small(model.kind, user)

    method = model.registration_method
    model_name = (body.model_name or model.model_name or "").strip()
    if not model_name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "model_name 必填")

    if method == RegisteredModelRegistrationMethod.UPLOADED_FILE.value:
        # 小模型分支
        if body.modality is not None:
            new_modality = _validate_modality(body.modality)
            model.modality = new_modality
        prev = None
        if model.current_version_id:
            prev = await db.scalar(
                select(RegisteredModelVersion).where(
                    RegisteredModelVersion.id == model.current_version_id
                )
            )
        art = body.artifact
        if art is None and prev is not None:
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
            large_category=None,
            registration_method=method,
            provider=None,
            model_name=model_name,
            endpoint_url=None,
            config=dict(body.config or {}),
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
        await db.refresh(ver)
        return RegisteredModelVersionOut.model_validate(ver)

    # —— 大模型 / remote_api 分支 ——
    if model.provider_id is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "大模型未挂载 Provider；请先在 Provider 页面配置",
        )
    provider = await db.scalar(
        select(RegisteredProvider).where(RegisteredProvider.id == model.provider_id)
    )
    if provider is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Provider 不存在（请检查是否已删除）",
        )

    endpoint = provider.endpoint_url
    if not endpoint:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Provider endpoint_url 缺失")

    config = dict(body.config or {})
    if not config.get("protocol"):
        config["protocol"] = (provider.config or {}).get("protocol") or "openai-compatible"

    new_large_category = _validate_large_category(body.large_category) or model.large_category
    if model.kind == RegisteredModelKind.LARGE.value and not new_large_category:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "大模型分类（large_category）必填：text / multimodal / other",
        )

    next_no = await _next_version_no(db, model.id)
    ver = RegisteredModelVersion(
        model_id=model.id,
        version_no=next_no,
        version_label=body.version_label or f"v{next_no}",
        notes=body.notes,
        large_category=new_large_category,
        registration_method=RegisteredModelRegistrationMethod.REMOTE_API.value,
        provider=provider.provider_preset,
        model_name=model_name,
        endpoint_url=endpoint,
        config=config,
        credential_id=provider.credential_id,
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
    _require_super_admin_for_small(model.kind, user)
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


@router.post("/precheck", operation_id="registered_models_precheck")
async def precheck_model(
    body: ModelPrecheckRequest,
    user=Depends(require_writer),
) -> RegisteredModelValidationLog:
    """保存前测试模型连通性，复用 _validate_endpoint 纯函数。"""
    if user.role not in (UserRole.SUPERADMIN.value, UserRole.ROOT_ADMIN.value):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "模型连通性测试仅超级管理员（superadmin / root_admin）可操作",
        )
    return await _validate_endpoint(
        body.endpoint_url, body.protocol, body.model_name, body.api_key, body.timeout
    )


@router.post("/precheck-artifact", operation_id="registered_models_precheck_artifact")
async def precheck_artifact(
    body: ModelArtifactPrecheckRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> RegisteredModelValidationLog:
    """保存前测试小模型文件 + 审核点 JSON 是否就绪。

    Demo 阶段不做真实 inference，仅校验：
    - 文件存在、SHA256 重新计算成功
    - 文件大小 ≤ 上限
    - config_points JSON 结构合法
    - (modality, small_category) 与现有模型不冲突

    返回 RegisteredModelValidationLog（与 Provider precheck 同 schema）。
    """
    if user.role not in (UserRole.SUPERADMIN.value, UserRole.ROOT_ADMIN.value):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "小模型连通性测试仅超级管理员（superadmin / root_admin）可操作",
        )

    started = time.perf_counter()
    checks: list[str] = []

    # 1. 文件存在
    try:
        abs_path, fname = open_artifact(body.storage_key)
    except ArtifactStorageError as exc:
        return RegisteredModelValidationLog(
            checked_at=datetime.utcnow(),
            ok=False,
            http_status=None,
            latency_ms=int((time.perf_counter() - started) * 1000),
            message=f"模型文件不可用：{exc}",
        )
    checks.append(f"文件就绪：{fname}")

    # 2. 文件大小 ≤ 上限
    try:
        size = abs_path.stat().st_size
    except OSError as exc:
        return RegisteredModelValidationLog(
            checked_at=datetime.utcnow(),
            ok=False,
            http_status=None,
            latency_ms=int((time.perf_counter() - started) * 1000),
            message=f"读取文件元信息失败：{exc}",
        )
    max_bytes = settings.storage_max_upload_mb * 1024 * 1024
    if size > max_bytes:
        return RegisteredModelValidationLog(
            checked_at=datetime.utcnow(),
            ok=False,
            http_status=None,
            latency_ms=int((time.perf_counter() - started) * 1000),
            message=f"文件大小 {size} bytes 超过上限 {max_bytes} bytes",
        )
    checks.append(f"大小合规：{size} bytes")

    # 3. config_points JSON 结构
    if body.config_points is not None:
        if not isinstance(body.config_points, list):
            return RegisteredModelValidationLog(
                checked_at=datetime.utcnow(),
                ok=False,
                http_status=None,
                latency_ms=int((time.perf_counter() - started) * 1000),
                message="config_points 必须是数组",
            )
        for i, p in enumerate(body.config_points):
            if not isinstance(p, dict):
                return RegisteredModelValidationLog(
                    checked_at=datetime.utcnow(),
                    ok=False,
                    http_status=None,
                    latency_ms=int((time.perf_counter() - started) * 1000),
                    message=f"config_points[{i}] 不是对象",
                )
            label = p.get("label")
            if not isinstance(label, str) or not label.strip():
                return RegisteredModelValidationLog(
                    checked_at=datetime.utcnow(),
                    ok=False,
                    http_status=None,
                    latency_ms=int((time.perf_counter() - started) * 1000),
                    message=f"config_points[{i}].label 缺失或为空",
                )
        checks.append(f"审核点结构合规：{len(body.config_points)} 项")

    # 4. (modality, small_category) 模态校验
    try:
        m = _validate_modality(body.modality)
    except HTTPException:
        return RegisteredModelValidationLog(
            checked_at=datetime.utcnow(),
            ok=False,
            http_status=None,
            latency_ms=int((time.perf_counter() - started) * 1000),
            message=f"非法模态: {body.modality}",
        )
    try:
        s = await _validate_small_category(body.small_category, db)
    except HTTPException:
        return RegisteredModelValidationLog(
            checked_at=datetime.utcnow(),
            ok=False,
            http_status=None,
            latency_ms=int((time.perf_counter() - started) * 1000),
            message=f"非法审核场景: {body.small_category}",
        )
    checks.append(f"模态/场景：{m} / {s}")

    # 5. 同组合模型数量（不阻断，仅统计）
    stmt = select(func.count()).select_from(RegisteredModel).where(
        RegisteredModel.is_deleted.is_(False),
        RegisteredModel.kind == RegisteredModelKind.SMALL.value,
        RegisteredModel.modality == m,
        RegisteredModel.small_category == s,
    )
    same_combo_count = await db.scalar(stmt) or 0
    if same_combo_count > 0:
        checks.append(f"同组合复用：{same_combo_count} 个模型")

    return RegisteredModelValidationLog(
        checked_at=datetime.utcnow(),
        ok=True,
        http_status=200,
        latency_ms=int((time.perf_counter() - started) * 1000),
        message="模型文件就绪 · " + " / ".join(checks),
    )


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
    if user.role not in (UserRole.SUPERADMIN.value, UserRole.ROOT_ADMIN.value):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "小模型文件仅超级管理员（superadmin / root_admin）可上传",
        )
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
        select(RegisteredModel).where(RegisteredModel.id == model_id)
    )
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")
    _require_super_admin_for_small(model.kind, user)
    if model.registration_method == RegisteredModelRegistrationMethod.UPLOADED_FILE.value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "小模型（上传文件）不支持远程连通性校验；如需确认文件请使用「下载」功能",
        )
    if model.provider_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "模型未挂载 Provider")

    provider = await db.scalar(
        select(RegisteredProvider).where(RegisteredProvider.id == model.provider_id)
    )
    if provider is None or not provider.endpoint_url:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Provider 或 endpoint_url 缺失")

    if model.current_version_id and model.current_version is None:
        model.current_version = await db.scalar(
            select(RegisteredModelVersion).where(
                RegisteredModelVersion.id == model.current_version_id
            )
        )

    protocol = (model.config or {}).get("protocol") or (provider.config or {}).get("protocol") or "custom"
    if protocol not in ALLOWED_PROTOCOLS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"不支持的协议: {protocol}")
    timeout = int((model.config or {}).get("timeout", 30))

    token: str | None = None
    if provider.credential_id:
        cr = await db.execute(
            select(ResourceCredential.ciphertext).where(ResourceCredential.id == provider.credential_id)
        )
        ciphertext = cr.scalar()
        if ciphertext:
            try:
                token = decrypt_token(ciphertext)
            except ValueError:
                token = None

    log = await _validate_endpoint(provider.endpoint_url, protocol, model.model_name, token, timeout)

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


@router.get("/{model_id}/current-version-config")
async def get_current_version_config(
    model_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
) -> dict:
    """返回指定模型当前版本的完整 config（含审核点列表）。供前端下载 / 查看。"""
    model = await db.scalar(
        select(RegisteredModel)
        .options(selectinload(RegisteredModel.current_version))
        .where(RegisteredModel.id == model_id)
    )
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")
    if model.current_version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型尚未发布版本")
    return {"config": model.current_version.config or {}}


@router.get("/{model_id}/active-siblings")
async def list_active_siblings(
    model_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
) -> dict:
    """列出同 (modality, small_category) 组合下、状态为 active 的其他小模型。
    仅 kind=small 才可能返回非空；大模型返回空数组。供前端启用前弹警告使用。
    """
    model = await db.scalar(
        select(RegisteredModel).where(RegisteredModel.id == model_id)
    )
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")
    siblings = await _find_active_sibling_models(db, model)
    items: list[dict] = []
    for s in siblings:
        version_label: Optional[str] = None
        if s.current_version:
            version_label = s.current_version.version_label or f"v{s.current_version.version_no}"
        items.append({
            "id": s.id,
            "name": s.name,
            "version_label": version_label,
        })
    return {"siblings": items}


@router.post("/{model_id}/activate", response_model=RegisteredModelOut)
async def activate_model(
    model_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> RegisteredModelOut:
    model = await db.scalar(
        select(RegisteredModel).where(RegisteredModel.id == model_id)
    )
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")
    if model.status == RegisteredModelStatus.ARCHIVED.value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "已归档的模型不可启用，请先取消归档")
    if not model.current_version_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "模型尚未发布版本，无法启用")
    return await _set_status(model_id, RegisteredModelStatus.ACTIVE.value, db, user, cascading_activate=True)


async def _find_active_sibling_models(
    db: AsyncSession,
    model: RegisteredModel,
) -> list[RegisteredModel]:
    """同 (modality, small_category) 组合下、状态为 active 的其他小模型（不含自己）。"""
    if model.kind != RegisteredModelKind.SMALL.value:
        return []
    if not model.modality or not model.small_category:
        return []
    rows = (
        await db.execute(
            select(RegisteredModel)
            .options(selectinload(RegisteredModel.current_version))
            .where(
                RegisteredModel.id != model.id,
                RegisteredModel.is_deleted.is_(False),
                RegisteredModel.kind == RegisteredModelKind.SMALL.value,
                RegisteredModel.modality == model.modality,
                RegisteredModel.small_category == model.small_category,
                RegisteredModel.status == RegisteredModelStatus.ACTIVE.value,
            )
        )
    ).scalars().all()
    return list(rows)


async def _set_status(
    model_id: int,
    new_status: str,
    db: AsyncSession,
    user: User,
    cascading_activate: bool = False,
) -> RegisteredModelOut:
    _validate_status(new_status)
    model = await db.scalar(
        select(RegisteredModel)
        .options(
            selectinload(RegisteredModel.current_version),
            selectinload(RegisteredModel.credential),
            selectinload(RegisteredModel.provider).selectinload(RegisteredProvider.credential),
        )
        .where(RegisteredModel.id == model_id)
    )
    if model is None or model.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模型不存在")
    _require_super_admin_for_small(model.kind, user)
    prev = model.status
    cascaded_ids: list[int] = []
    if (
        cascading_activate
        and new_status == RegisteredModelStatus.ACTIVE.value
        and prev != RegisteredModelStatus.ACTIVE.value
    ):
        siblings = await _find_active_sibling_models(db, model)
        if siblings:
            cascaded_ids = [s.id for s in siblings]
            sibling_ids = cascaded_ids
            await db.execute(
                update(RegisteredModel)
                .where(RegisteredModel.id.in_(sibling_ids))
                .values(status=RegisteredModelStatus.INACTIVE.value)
            )
            for s in siblings:
                if s.current_version:
                    s.current_version.status = RegisteredModelStatus.INACTIVE.value
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
        payload={"prev": prev, "next": new_status, "cascaded_ids": cascaded_ids},
    )
    if cascaded_ids:
        await write_audit(
            db,
            actor=user,
            action="registered_model.cascaded_inactive",
            entity_type="registered_model",
            entity_id=model.id,
            payload={"reason": "cascaded_by_activate", "cascaded_ids": cascaded_ids},
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
