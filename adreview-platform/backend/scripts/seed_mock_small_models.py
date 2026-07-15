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
# Mock catalog — (small_category, modality, model_name, display_name, version_label, points, description)
# 13 entries covering 9 categories × {text, image} modalities
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class _MockSpec:
    small_category: str
    modality: str
    model_name: str
    name: str
    version_label: str
    points: tuple[str, ...]
    description: str


MOCK_SPECS: list[_MockSpec] = [
    # ── text modality (8) ──
    _MockSpec(
        SmallModelCategory.POLITICS.value, "text", "politics-cls-v3", "涉政文本分类器 v3", "1.0.0",
        ("一号领导人", "二号领导人", "敏感地名", "敏感事件", "反动言论", "历史虚无"),
        "基于 BERT 微调的文本分类模型，识别涉政敏感内容；适用于新闻、评论、帖子等场景。",
    ),
    _MockSpec(
        SmallModelCategory.TERRORISM.value, "text", "terrorism-cls-v2", "涉恐文本分类器 v2", "2.1.0",
        ("暴恐宣传", "恐怖组织", "自制爆炸物", "宗教极端"),
        "识别涉恐暴恐相关文本，覆盖国内外暴恐组织代号、武器制作等内容。",
    ),
    _MockSpec(
        SmallModelCategory.PORN.value, "text", "porn-cls-v3", "涉黄文本分类器 v3", "1.5.0",
        ("色情描写", "性行为暗示", "低俗恶趣", "擦边词汇"),
        "识别色情低俗文本内容，含隐晦擦边、谐音、缩写等变体。",
    ),
    _MockSpec(
        SmallModelCategory.ILLICIT.value, "text", "illicit-cls-v1", "违禁文本分类器 v1", "1.0.0",
        ("毒品", "管制刀具", "野生动物制品", "违禁药品"),
        "识别毒品、管制器具、违禁交易等相关文本。",
    ),
    _MockSpec(
        SmallModelCategory.AD.value, "image", "ad-img-cls-v2", "广告图片分类器 v2", "2.0.0",
        ("商业广告标识", "联系方式", "二维码推广", "促销文案"),
        "识别商业广告图片，含联系方式、二维码、品牌促销等元素。",
    ),
    _MockSpec(
        SmallModelCategory.AD_LAW.value, "text", "adlaw-cls-v1", "广告法文本分类器 v1", "1.2.0",
        ("绝对化用语", "虚假宣传", "医疗功效承诺", "投资回报承诺"),
        "识别违反《广告法》文本，含极限词、虚假承诺等违规表述。",
    ),
    _MockSpec(
        SmallModelCategory.ABUSE.value, "text", "abuse-cls-v2", "辱骂文本分类器 v2", "1.4.0",
        ("人身攻击", "脏话", "地域歧视", "性别歧视"),
        "识别辱骂攻击性文本，覆盖人身攻击、地域黑、歧视等。",
    ),
    _MockSpec(
        SmallModelCategory.UNHEALTHY.value, "text", "unhealthy-cls-v1", "不良文本分类器 v1", "1.0.0",
        ("血腥暴力", "自残自杀", "谣言误导", "封建迷信"),
        "识别不良信息文本，含血腥、自残、谣言等内容。",
    ),
    # ── image modality (5) ──
    _MockSpec(
        SmallModelCategory.POLITICS.value, "image", "politics-img-cls-v1", "涉政图片分类器 v1", "1.0.0",
        ("领导人照片", "敏感地标", "集会游行", "标语横幅"),
        "基于 CNN 的图像分类，识别涉政人物、地标、活动等敏感图片。",
    ),
    _MockSpec(
        SmallModelCategory.TERRORISM.value, "image", "terrorism-img-cls-v1", "涉恐图片分类器 v1", "1.0.0",
        ("暴力血腥画面", "恐怖组织旗帜", "武器装备", "恐怖符号"),
        "识别涉恐图片，含暴力血腥画面、武器装备、组织标识等。",
    ),
    _MockSpec(
        SmallModelCategory.PORN.value, "image", "porn-img-cls-v2", "涉黄图片分类器 v2", "1.8.0",
        ("裸露内容", "性行为暗示", "低俗恶趣", "擦边图片"),
        "图像分类识别色情低俗图片，含裸露、性暗示等元素。",
    ),
    _MockSpec(
        SmallModelCategory.ABUSE.value, "image", "abuse-img-cls-v1", "辱骂图片分类器 v1", "1.0.0",
        ("暴力斗殴", "侮辱性涂鸦", "歧视性图像"),
        "识别含暴力、侮辱、歧视元素的图片。",
    ),
    _MockSpec(
        SmallModelCategory.UNHEALTHY.value, "image", "unhealthy-img-cls-v1", "不良图片分类器 v1", "1.0.0",
        ("血腥图片", "自残图片", "封建迷信图像"),
        "识别不良图片，含血腥、自残、迷信等元素。",
    ),
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
        description=spec.description,
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
        config={"points": list(spec.points)},
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
        notes=f"demo seed: {spec.small_category}/{spec.modality}",
        large_category=None,
        registration_method=RegisteredModelRegistrationMethod.UPLOADED_FILE.value,
        provider=None,
        model_name=spec.model_name,
        endpoint_url=None,
        config={"points": list(spec.points)},
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
    updated: list[str] = []
    skipped: list[str] = []

    async with SessionLocal() as db:
        owner = await _admin_user(db)
        for spec in MOCK_SPECS:
            existing = await _exists(db, spec.model_name)
            if existing is None:
                m = await _seed_one(db, spec, owner)
                created.append((m.id, spec.model_name))
            elif existing.config != {"points": list(spec.points)} or existing.description != spec.description:
                existing.description = spec.description
                existing.config = {"points": list(spec.points)}
                if existing.current_version_id:
                    ver = await db.get(RegisteredModelVersion, existing.current_version_id)
                    if ver:
                        ver.config = {"points": list(spec.points)}
                        ver.notes = f"demo seed: {spec.small_category}/{spec.modality}"
                updated.append(spec.model_name)
            else:
                skipped.append(spec.model_name)
        await db.commit()

    print(f"[mock] created {len(created)} updated {len(updated)} skipped {len(skipped)}")
    for mid, mn in created:
        print(f"  + id={mid:>3}  {mn}")
    for mn in updated:
        print(f"  ~ refresh {mn}")
    for mn in skipped:
        print(f"  = skip    {mn}")


if __name__ == "__main__":
    asyncio.run(main())