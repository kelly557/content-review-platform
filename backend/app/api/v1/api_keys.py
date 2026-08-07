"""API Keys router — tenant-scoped service token management.

守卫: require_superadmin (superadmin / root_admin)。列表可按 tenant_id 过滤;
平台管理员可见全部, 业务 superadmin 仅可见自己租户的 key (MVP: superadmin
可看全部, 后续按 tenant 隔离)。
"""
from __future__ import annotations

import hashlib
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_superadmin
from app.db.session import get_db
from app.models.api_key import ApiKey, _gen_key_plaintext, key_prefix
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.api_key import ApiKeyCreate, ApiKeyCreated, ApiKeyOut, ApiKeyListParams

router = APIRouter(prefix="/admin/api-keys", tags=["admin-api-keys"])


def _hash_key(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def _status_of(k: ApiKey) -> str:
    if k.revoked_at:
        return "revoked"
    if k.expires_at and k.expires_at < datetime.utcnow():
        return "expired"
    return "active"


def _to_out(k: ApiKey) -> ApiKeyOut:
    return ApiKeyOut.model_validate(k)


@router.get("", response_model=List[ApiKeyOut])
async def list_keys(
    tenant_id: Optional[int] = None,
    scope: Optional[str] = None,
    status: Optional[str] = None,
    q: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
) -> List[ApiKeyOut]:
    stmt = select(ApiKey).order_by(ApiKey.created_at.desc())
    if tenant_id is not None:
        stmt = stmt.where(ApiKey.tenant_id == tenant_id)
    if scope:
        stmt = stmt.where(ApiKey.scope == scope)
    result = await db.execute(stmt)
    items = list(result.scalars())
    # status / q 在 Python 侧过滤（量小，避免动态条件复杂化）
    if status:
        items = [k for k in items if _status_of(k) == status]
    if q:
        ql = q.lower()
        items = [
            k for k in items
            if ql in k.name.lower()
            or (k.description or "").lower().find(ql) >= 0
            or ql in k.key_prefix.lower()
        ]
    return [_to_out(k) for k in items]


@router.post("", response_model=ApiKeyCreated, status_code=status.HTTP_201_CREATED)
async def create_key(
    body: ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
) -> ApiKeyCreated:
    tenant = await db.get(Tenant, body.tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="租户不存在")
    plaintext = _gen_key_plaintext()
    k = ApiKey(
        tenant_id=body.tenant_id,
        name=body.name,
        description=body.description,
        key_prefix=key_prefix(plaintext),
        key_hash=_hash_key(plaintext),
        scope=body.scope,
        created_by=user.email or user.username,
        expires_at=body.expires_at,
    )
    db.add(k)
    await db.flush()
    await db.commit()
    await db.refresh(k)
    return ApiKeyCreated(**_to_out(k).model_dump(), plaintext=plaintext)


@router.post("/{key_id}/revoke", response_model=ApiKeyOut)
async def revoke_key(
    key_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
) -> ApiKeyOut:
    k = await db.get(ApiKey, key_id)
    if not k:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API Key 不存在")
    if k.revoked_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="API Key 已撤销")
    k.revoked_at = datetime.utcnow()
    await db.flush()
    await db.commit()
    await db.refresh(k)
    return _to_out(k)


@router.post("/{key_id}/rotate", response_model=ApiKeyCreated)
async def rotate_key(
    key_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
) -> ApiKeyCreated:
    old = await db.get(ApiKey, key_id)
    if not old:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API Key 不存在")
    if old.revoked_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="API Key 已撤销，无法轮换",
        )
    # 撤销旧 key
    old.revoked_at = datetime.utcnow()
    # 生成新 key（同 tenant / name / scope / expires_at）
    plaintext = _gen_key_plaintext()
    fresh = ApiKey(
        tenant_id=old.tenant_id,
        name=old.name,
        description=old.description,
        key_prefix=key_prefix(plaintext),
        key_hash=_hash_key(plaintext),
        scope=old.scope,
        created_by=old.created_by,
        expires_at=old.expires_at,
    )
    db.add(fresh)
    await db.flush()
    await db.commit()
    await db.refresh(fresh)
    return ApiKeyCreated(**_to_out(fresh).model_dump(), plaintext=plaintext)


@router.delete("/{key_id}", status_code=status.HTTP_200_OK)
async def delete_key(
    key_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
) -> dict:
    k = await db.get(ApiKey, key_id)
    if not k:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API Key 不存在")
    await db.delete(k)
    await db.commit()
    return {"ok": True, "id": key_id}
