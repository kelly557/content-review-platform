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
* ``config.points`` is a list of ``{label, description}`` objects — each audit
  point has a short label (the category the model classifies) and a free-form
  description explaining what the point means for downstream reviewers.

Run::

    cd backend && source .venv/bin/activate
    PYTHONPATH=. python3 scripts/seed_mock_small_models.py
"""
from __future__ import annotations

import asyncio
import io
from dataclasses import dataclass
from typing import Any

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


@dataclass(frozen=True)
class _Point:
    label: str
    description: str


# ---------------------------------------------------------------------------
# Mock catalog — (small_category, modality, model_name, display_name,
#                  version_label, points, description)
# 13 entries covering 9 categories × {text, image} modalities
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class _MockSpec:
    small_category: str
    modality: str
    model_name: str
    name: str
    version_label: str
    points: tuple[_Point, ...]
    description: str


def _p(label: str, description: str) -> _Point:
    return _Point(label=label, description=description)


MOCK_SPECS: list[_MockSpec] = [
    _MockSpec(
        SmallModelCategory.POLITICS.value, "text", "politics-cls-v3", "涉政文本分类器 v3", "1.0.0",
        (
            _p("一号领导人", "检测文本中是否出现一号领导人姓名/称谓"),
            _p("二号领导人", "检测文本中是否出现二号领导人姓名/称谓"),
            _p("敏感地名", "检测文本中是否提及敏感政治地点"),
            _p("敏感事件", "检测文本中是否提及敏感历史/政治事件"),
            _p("反动言论", "检测文本中是否包含反政府、反社会制度等言论"),
            _p("历史虚无", "检测文本中是否歪曲/否定重要历史事件"),
        ),
        "基于 BERT 微调的文本分类模型，识别涉政敏感内容；适用于新闻、评论、帖子等场景。",
    ),
    _MockSpec(
        SmallModelCategory.TERRORISM.value, "text", "terrorism-cls-v2", "涉恐文本分类器 v2", "2.1.0",
        (
            _p("暴恐宣传", "检测文本中是否包含宣扬恐怖主义的文字"),
            _p("恐怖组织", "检测文本中是否提及国内外恐怖组织代号/名称"),
            _p("自制爆炸物", "检测文本中是否描述爆炸物/武器制作方法"),
            _p("宗教极端", "检测文本中是否包含极端宗教思想"),
        ),
        "识别涉恐暴恐相关文本，覆盖国内外暴恐组织代号、武器制作等内容。",
    ),
    _MockSpec(
        SmallModelCategory.PORN.value, "text", "porn-cls-v3", "涉黄文本分类器 v3", "1.5.0",
        (
            _p("色情描写", "检测文本中是否含露骨色情描写"),
            _p("性行为暗示", "检测文本中是否含隐晦性暗示"),
            _p("低俗恶趣", "检测文本中是否含低俗恶趣味表达"),
            _p("擦边词汇", "检测文本中是否含擦边谐音缩写"),
        ),
        "识别色情低俗文本内容，含隐晦擦边、谐音、缩写等变体。",
    ),
    _MockSpec(
        SmallModelCategory.ILLICIT.value, "text", "illicit-cls-v1", "违禁文本分类器 v1", "1.0.0",
        (
            _p("毒品", "检测文本中是否提及毒品名称或交易暗语"),
            _p("管制刀具", "检测文本中是否提及管制刀具"),
            _p("野生动物制品", "检测文本中是否涉及野生动物及其制品"),
            _p("违禁药品", "检测文本中是否含违禁药品成分"),
        ),
        "识别毒品、管制器具、违禁交易等相关文本。",
    ),
    _MockSpec(
        SmallModelCategory.AD.value, "image", "ad-img-cls-v2", "广告图片分类器 v2", "2.0.0",
        (
            _p("商业广告标识", "检测图片中是否含商业品牌 logo/广告标识"),
            _p("联系方式", "检测图片中是否含电话/邮箱/地址等联系方式"),
            _p("二维码推广", "检测图片中是否含推广二维码"),
            _p("促销文案", "检测图片中是否含促销文字"),
        ),
        "识别商业广告图片，含联系方式、二维码、品牌促销等元素。",
    ),
    _MockSpec(
        SmallModelCategory.AD_LAW.value, "text", "adlaw-cls-v1", "广告法文本分类器 v1", "1.2.0",
        (
            _p("绝对化用语", "检测文本中是否含「最/第一/国家级」等绝对化极限词"),
            _p("虚假宣传", "检测文本中是否含虚假或引人误解的宣传"),
            _p("医疗功效承诺", "检测文本中是否含保证治愈率/有效率的医疗承诺"),
            _p("投资回报承诺", "检测文本中是否含保本/无风险/高回报投资承诺"),
        ),
        "识别违反《广告法》文本，含极限词、虚假承诺等违规表述。",
    ),
    _MockSpec(
        SmallModelCategory.ABUSE.value, "text", "abuse-cls-v2", "辱骂文本分类器 v2", "1.4.0",
        (
            _p("人身攻击", "检测文本中是否含针对特定人的侮辱谩骂"),
            _p("脏话", "检测文本中是否含脏话粗口"),
            _p("地域歧视", "检测文本中是否含地域歧视性表述"),
            _p("性别歧视", "检测文本中是否含性别歧视性表述"),
        ),
        "识别辱骂攻击性文本，覆盖人身攻击、地域黑、歧视等。",
    ),
    _MockSpec(
        SmallModelCategory.UNHEALTHY.value, "text", "unhealthy-cls-v1", "不良文本分类器 v1", "1.0.0",
        (
            _p("血腥暴力", "检测文本中是否含详细血腥暴力描写"),
            _p("自残自杀", "检测文本中是否含自残自杀相关内容"),
            _p("谣言误导", "检测文本中是否含未经证实的谣言/误导信息"),
            _p("封建迷信", "检测文本中是否含封建迷信内容"),
        ),
        "识别不良信息文本，含血腥、自残、谣言等内容。",
    ),
    _MockSpec(
        SmallModelCategory.POLITICS.value, "image", "politics-img-cls-v1", "涉政图片分类器 v1", "1.0.0",
        (
            _p("领导人照片", "检测图片中是否含领导人照片"),
            _p("敏感地标", "检测图片中是否含敏感政治地标"),
            _p("集会游行", "检测图片中是否含集会游行场景"),
            _p("标语横幅", "检测图片中是否含敏感标语横幅"),
        ),
        "基于 CNN 的图像分类，识别涉政人物、地标、活动等敏感图片。",
    ),
    _MockSpec(
        SmallModelCategory.TERRORISM.value, "image", "terrorism-img-cls-v1", "涉恐图片分类器 v1", "1.0.0",
        (
            _p("暴力血腥画面", "检测图片中是否含暴力血腥画面"),
            _p("恐怖组织旗帜", "检测图片中是否含恐怖组织旗帜/标识"),
            _p("武器装备", "检测图片中是否含武器装备"),
            _p("恐怖符号", "检测图片中是否含恐怖符号"),
        ),
        "识别涉恐图片，含暴力血腥画面、武器装备、组织标识等。",
    ),
    _MockSpec(
        SmallModelCategory.PORN.value, "image", "porn-img-cls-v2", "涉黄图片分类器 v2", "1.8.0",
        (
            _p("裸露内容", "检测图片中是否含裸露人体"),
            _p("性行为暗示", "检测图片中是否含性行为暗示"),
            _p("低俗恶趣", "检测图片中是否含低俗恶趣元素"),
            _p("擦边图片", "检测图片中是否含擦边元素"),
        ),
        "图像分类识别色情低俗图片，含裸露、性暗示等元素。",
    ),
    _MockSpec(
        SmallModelCategory.ABUSE.value, "image", "abuse-img-cls-v1", "辱骂图片分类器 v1", "1.0.0",
        (
            _p("暴力斗殴", "检测图片中是否含暴力斗殴场景"),
            _p("侮辱性涂鸦", "检测图片中是否含侮辱性涂鸦"),
            _p("歧视性图像", "检测图片中是否含歧视性图像内容"),
        ),
        "识别含暴力、侮辱、歧视元素的图片。",
    ),
    _MockSpec(
        SmallModelCategory.UNHEALTHY.value, "image", "unhealthy-img-cls-v1", "不良图片分类器 v1", "1.0.0",
        (
            _p("血腥图片", "检测图片中是否含血腥元素"),
            _p("自残图片", "检测图片中是否含自残相关元素"),
            _p("封建迷信图像", "检测图片中是否含封建迷信内容"),
        ),
        "识别不良图片，含血腥、自残、迷信等元素。",
    ),
]


def _points_to_config(points: tuple[_Point, ...]) -> dict[str, Any]:
    return {"points": [{"label": p.label, "description": p.description} for p in points]}


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


def _config_matches(existing: Any, expected: dict[str, Any]) -> bool:
    """Compare config; legacy string arrays are NEVER considered matching — they
    need upgrade to the ``{label, description}`` object format."""
    if not isinstance(existing, dict) or not isinstance(expected, dict):
        return False
    if set(existing.keys()) != set(expected.keys()):
        return False
    ex_points = existing.get("points") or []
    new_points = expected.get("points") or []
    if len(ex_points) != len(new_points):
        return False
    for i, expected_pt in enumerate(new_points):
        ex_pt = ex_points[i]
        if not isinstance(ex_pt, dict):
            return False
        if ex_pt.get("label") != expected_pt["label"]:
            return False
        if ex_pt.get("description") != expected_pt["description"]:
            return False
    return True


async def _seed_one(db: AsyncSession, spec: _MockSpec, owner: User) -> RegisteredModel:
    placeholder = io.BytesIO(b"\x00" * 16)
    art = save_artifact(f"{spec.model_name}.bin", placeholder)
    cfg = _points_to_config(spec.points)

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
        config=cfg,
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
        config=cfg,
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
            expected_config = _points_to_config(spec.points)
            existing = await _exists(db, spec.model_name)
            if existing is None:
                m = await _seed_one(db, spec, owner)
                created.append((m.id, spec.model_name))
            elif (
                existing.description != spec.description
                or not _config_matches(existing.config or {}, expected_config)
            ):
                existing.description = spec.description
                existing.config = expected_config
                if existing.current_version_id:
                    ver = await db.get(RegisteredModelVersion, existing.current_version_id)
                    if ver:
                        ver.config = expected_config
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