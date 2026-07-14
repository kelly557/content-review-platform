"""Seed mock small models for the model registry (dev only).

Generates 13 small models across all 9 small categories × {text, image} modalities
for the platform team to exercise the resource-library UI and to seed a stable
catalog that downstream rules (通用文本 / 通用图片) can reference by id.

Behavior
--------
* Idempotent: skips a (small_category, modality, model_name) tuple that already
  exists; re-running the script is a no-op for already-seeded models.
* Writes a tiny placeholder file (16 bytes of zeros) per model so the artifact
  download endpoint can resolve storage_key. The file is intentionally not a
  real .onnx/.pt binary; downloading yields 16 bytes — sufficient to verify the
  list/download UI flow without polluting ``storage/models/`` with hundreds of
  megabytes of dummy weights.
* Status defaults to ``active``; ``current_version_id`` points to a synthetic
  v1 row so list/detail pages render without additional uploads.
* The 9 categories + 2 modalities = 18 tuples; we create 13 by leaving out
  ``illicit/image``, ``religion/text``, ``religion/image``, ``ad_law/image``,
  ``ad/text`` (5 slots remain for end-to-end QA via the UI).

Run::

    cd backend && source .venv/bin/activate
    PYTHONPATH=. python3 scripts/seed_mock_small_models.py
"""
from __future__ import annotations

import asyncio
import io
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Base  # noqa: F401  -- triggers model registration
from app.db.session import SessionLocal, engine
from app.models.registered_model import (
    RegisteredModel,
    RegisteredModelRegistrationMethod,
    RegisteredModelStatus,
    RegisteredModelVersion,
    RegisteredModelVersionStatus,
    SmallModelCategory,
)
from app.models.user import User
from app.services.code_generator import generate_registered_model_code
from app.services.model_artifact_storage import save_artifact


# ---------------------------------------------------------------------------
# Mock catalog — (small_category, modality, model_name, display_name, label)
# 13 entries covering 9 categories × {text, image} modalities
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class _MockSpec:
    small_category: str
    modality: str
    model_name: str
    name: str
    version_label: str


MOCK_SPECS: list[_MockSpec] = [
    # ── text modality (8) ──
    _MockSpec(SmallModelCategory.POLITICS.value, "text", "politics-cls-v3", "涉政文本分类器 v3", "1.0.0"),
    _MockSpec(SmallModelCategory.TERRORISM.value, "text", "terrorism-cls-v2", "涉恐文本分类器 v2", "2.1.0"),
    _MockSpec(SmallModelCategory.PORN.value, "text", "porn-cls-v3", "涉黄文本分类器 v3", "1.5.0"),
    _MockSpec(SmallModelCategory.ILLICIT.value, "text", "illicit-cls-v1", "违禁文本分类器 v1", "1.0.0"),
    _MockSpec(SmallModelCategory.AD.value, "image", "ad-img-cls-v2", "广告图片分类器 v2", "2.0.0"),
    _MockSpec(SmallModelCategory.AD_LAW.value, "text", "adlaw-cls-v1", "广告法文本分类器 v1", "1.2.0"),
    _MockSpec(SmallModelCategory.ABUSE.value, "text", "abuse-cls-v2", "辱骂文本分类器 v2", "1.4.0"),
    _MockSpec(SmallModelCategory.UNHEALTHY.value, "text", "unhealthy-cls-v1", "不良文本分类器 v1", "1.0.0"),
    # ── image modality (5) ──
    _MockSpec(SmallModelCategory.POLITICS.value, "image", "politics-img-cls-v1", "涉政图片分类器 v1", "1.0.0"),
    _MockSpec(SmallModelCategory.TERRORISM.value, "image", "terrorism-img-cls-v1", "涉恐图片分类器 v1", "1.0.0"),
    _MockSpec(SmallModelCategory.PORN.value, "image", "porn-img-cls-v2", "涉黄图片分类器 v2", "1.8.0"),
    _MockSpec(SmallModelCategory.ABUSE.value, "image", "abuse-img-cls-v1", "辱骂图片分类器 v1", "1.0.0"),
    _MockSpec(SmallModelCategory.UNHEALTHY.value, "image", "unhealthy-img-cls-v1", "不良图片分类器 v1", "1.0.0"),
]


async def _admin_user(db: AsyncSession) -> User:
    u = await db.scalar(
        select(User).where(User.email == "admin@adreview.example.com")
    )
    if u is None:
        raise RuntimeError(
            "admin@adreview.example.com not found — run scripts/seed.py first."
        )
    return u


async def _exists(db: AsyncSession, model_name: str) -> RegisteredModel | None:
    return await db.scalar(
        select(RegisteredModel).where(RegisteredModel.model_name == model_name)
    )


async def _seed_one(db: AsyncSession, spec: _MockSpec, owner: User) -> RegisteredModel:
    # 写一个 16 字节的占位文件供 storage_key 解析
    placeholder = io.BytesIO(b"\x00" * 16)
    art = save_artifact(f"{spec.model_name}.bin", placeholder)

    model = RegisteredModel(
        code=generate_registered_model_code(),
        name=spec.name,
        description=f"mock seed: {spec.small_category}/{spec.modality}",
        kind="small",
        small_category=spec.small_category,
        modality=spec.modality,
        large_category=None,
        provider_id=None,
        model_name=spec.model_name,
        max_output_tokens=2048,
        registration_method=RegisteredModelRegistrationMethod.UPLOADED_FILE.value,
        status=RegisteredModelStatus.ACTIVE.value,
        version=spec.version_label,
        config={},
        owner_id=owner.id,
        created_by_id=owner.id,
        updated_by_id=owner.id,
    )
    db.add(model)
    await db.flush()

    ver = RegisteredModelVersion(
        model_id=model.id,
        version_no=1,
        version_label=spec.version_label,
        notes="mock seed v1",
        large_category=None,
        registration_method=RegisteredModelRegistrationMethod.UPLOADED_FILE.value,
        provider=None,
        model_name=spec.model_name,
        endpoint_url=None,
        config={},
        credential_id=None,
        artifact_storage_key=art["storage_key"],
        artifact_filename=art["filename"],
        artifact_mime_type="application/octet-stream",
        artifact_size=art["size"],
        artifact_sha256=art["sha256"],
        status=RegisteredModelVersionStatus.ACTIVE.value,
        created_by_id=owner.id,
    )
    db.add(ver)
    await db.flush()
    model.current_version_id = ver.id
    await db.flush()
    return model


async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    created: list[tuple[int, str]] = []
    skipped: list[str] = []

    async with SessionLocal() as db:
        owner = await _admin_user(db)
        for spec in MOCK_SPECS:
            existing = await _exists(db, spec.model_name)
            if existing is not None:
                skipped.append(spec.model_name)
                continue
            m = await _seed_one(db, spec, owner)
            created.append((m.id, spec.model_name))
        await db.commit()

    print(f"[mock] created {len(created)} skipped {len(skipped)}")
    for mid, mn in created:
        print(f"  + id={mid:>3}  {mn}")
    for mn in skipped:
        print(f"  = skip    {mn}")


if __name__ == "__main__":
    asyncio.run(main())