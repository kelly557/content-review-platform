"""Seed QA test materials for the asset library.

Generates 16 high-risk ``draft`` materials across 4 types (text / image / pdf /
video) with 4 risk dimensions each. Audio is intentionally skipped because the
``MaterialType`` enum does not include it and ``STORAGE_ALLOWED_MIME`` rejects
audio formats.

Behavior
--------
* Idempotent: removes existing ``__QA__`` materials (cascade deletes versions)
  before re-inserting.
* Uses the default SUBMITTER user (Carol) created by ``seed.py``.
* For text materials: writes a real ``.txt`` placeholder via
  ``storage.save_upload`` so the download endpoint works.
* For non-text materials: does NOT write a real file. ``storage_key`` points
  to a ``placeholder.bin`` path that is not on disk; download will fail.
  This is a known limitation called out in the planning step.
* Status is left as ``draft``. No submit / workflow / review is triggered.

Run::

    cd backend && source .venv/bin/activate
    PYTHONPATH=. python3 scripts/seed_test_materials.py
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Base  # noqa: F401  -- triggers model registration
from app.db.session import SessionLocal, engine
from app.models.material import Material, MaterialStatus, MaterialType, MaterialVersion
from app.models.user import User
from app.services import storage


QA_TITLE_PREFIX = "__QA__"


# ---------------------------------------------------------------------------
# Payload definitions: (title, material_type, risk_label, text_body, mime, ext)
# ---------------------------------------------------------------------------

TEXT_PAYLOADS: List[dict] = [
    {
        "title": f"{QA_TITLE_PREFIX} text · 极限用语",
        "risk": "tx_advertising",
        "text_body": (
            "【品牌宣传文案】本产品是市面上最好的保健品，3 天根治失眠，"
            "100% 安全无副作用，疗效第一！立即下单，享受全网最低价。"
        ),
    },
    {
        "title": f"{QA_TITLE_PREFIX} text · 涉政表述",
        "risk": "tx_politics",
        "text_body": (
            "某领导人负面评论示例文本，包含敏感政治表述和不当言论，"
            "用于测试涉政违规检测规则。"
        ),
    },
    {
        "title": f"{QA_TITLE_PREFIX} text · 暴恐表述",
        "risk": "tx_terrorism",
        "text_body": (
            "【警告】示例：含极端组织名称、爆炸物制作方法等违规内容，"
            "用于测试暴恐违规检测规则。仅供审核引擎联调使用。"
        ),
    },
    {
        "title": f"{QA_TITLE_PREFIX} text · 辱骂低俗",
        "risk": "tx_abuse+tx_vulgar",
        "text_body": (
            "示例：含人身攻击、辱骂性词汇以及低俗色情暗示的混合文本，"
            "用于测试辱骂和低俗违规检测规则。"
        ),
    },
]

NON_TEXT_PAYLOADS: List[dict] = [
    # ----- image / 图文 -----
    {
        "title": f"{QA_TITLE_PREFIX} image · 二维码引流",
        "material_type": MaterialType.IMAGE,
        "risk": "pt_qrCode",
        "original_filename": "qrcode_poster.png",
        "mime_type": "image/png",
    },
    {
        "title": f"{QA_TITLE_PREFIX} image · 联系方式引流",
        "material_type": MaterialType.IMAGE,
        "risk": "pt_toDirectContact_tii",
        "original_filename": "contact_promo.png",
        "mime_type": "image/jpeg",
    },
    {
        "title": f"{QA_TITLE_PREFIX} image · 社交平台水印",
        "material_type": MaterialType.IMAGE,
        "risk": "pt_logotoSocialNetwork",
        "original_filename": "douyin_watermark.png",
        "mime_type": "image/png",
    },
    {
        "title": f"{QA_TITLE_PREFIX} image · 投资理财引流",
        "material_type": MaterialType.IMAGE,
        "risk": "pt_investment_tii",
        "original_filename": "invest_finance_ad.jpg",
        "mime_type": "image/jpeg",
    },
    # ----- pdf / 图文拼版 -----
    {
        "title": f"{QA_TITLE_PREFIX} pdf · 广告法极限词+二维码",
        "material_type": MaterialType.PDF,
        "risk": "pt_qrCode+tx_advertising",
        "original_filename": "best_breast_milk_substitute.pdf",
        "mime_type": "application/pdf",
    },
    {
        "title": f"{QA_TITLE_PREFIX} pdf · 涉政",
        "material_type": MaterialType.PDF,
        "risk": "tx_politics",
        "original_filename": "politics_brochure.pdf",
        "mime_type": "application/pdf",
    },
    {
        "title": f"{QA_TITLE_PREFIX} pdf · 医疗违规 Claim",
        "material_type": MaterialType.PDF,
        "risk": "tx_advertising(medical)",
        "original_filename": "medical_claim_leaflet.pdf",
        "mime_type": "application/pdf",
    },
    {
        "title": f"{QA_TITLE_PREFIX} pdf · 暴恐",
        "material_type": MaterialType.PDF,
        "risk": "tx_terrorism",
        "original_filename": "terrorism_leaflet.pdf",
        "mime_type": "application/pdf",
    },
    # ----- video -----
    {
        "title": f"{QA_TITLE_PREFIX} video · 未成年保护",
        "material_type": MaterialType.VIDEO,
        "risk": "tx_minor_protection",
        "original_filename": "minor_promo_short.mp4",
        "mime_type": "video/mp4",
    },
    {
        "title": f"{QA_TITLE_PREFIX} video · 投资理财引流",
        "material_type": MaterialType.VIDEO,
        "risk": "pt_investment_tii",
        "original_filename": "finance_short_video.mp4",
        "mime_type": "video/mp4",
    },
    {
        "title": f"{QA_TITLE_PREFIX} video · 兼职招聘引流",
        "material_type": MaterialType.VIDEO,
        "risk": "pt_recruitment_tii",
        "original_filename": "part_time_recruit.mp4",
        "mime_type": "video/mp4",
    },
    {
        "title": f"{QA_TITLE_PREFIX} video · 色情低俗",
        "material_type": MaterialType.VIDEO,
        "risk": "tx_porn+tx_vulgar",
        "original_filename": "vulgar_short_video.mp4",
        "mime_type": "video/mp4",
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_submitter(db: AsyncSession) -> User:
    result = await db.execute(
        select(User).where(User.email == "submitter@adreview.example.com")
    )
    user = result.scalar_one_or_none()
    if not user:
        raise SystemExit(
            "SUBMITTER user (submitter@adreview.example.com) not found. "
            "Run `python3 scripts/seed.py` first."
        )
    return user


async def _purge_existing(db: AsyncSession) -> int:
    """Delete all existing __QA__ materials.

    Explicitly delete versions first to avoid ORM emitting
    ``UPDATE material_versions SET material_id=NULL`` (which would violate
    NOT NULL on the FK column). The schema's ON DELETE CASCADE handles
    production paths, but for in-script cleanup we drive the deletes
    ourselves.
    """
    from app.models.material import MaterialVersion

    result = await db.execute(
        select(Material).where(Material.title.like(f"{QA_TITLE_PREFIX}%"))
    )
    rows = result.scalars().all()
    for m in rows:
        vresult = await db.execute(
            select(MaterialVersion).where(MaterialVersion.material_id == m.id)
        )
        for v in vresult.scalars().all():
            await db.delete(v)
        await db.flush()
        await db.delete(m)
    await db.flush()
    return len(rows)


def _today_ext() -> str:
    return datetime.utcnow().strftime("%Y%m%d")


async def _create_text_material(
    db: AsyncSession, submitter: User, payload: dict
) -> Material:
    """Create a TEXT material: write a real .txt placeholder via storage.save_upload."""
    material = Material(
        title=payload["title"],
        description=f"QA test data, risk: {payload['risk']}",
        material_type=MaterialType.TEXT,
        status=MaterialStatus.DRAFT,
        tags={"risk": payload["risk"], "source": "seed_qa"},
        extra_metadata={"risk_label": payload["risk"], "placeholder": True},
        submitter_id=submitter.id,
    )
    db.add(material)
    await db.flush()

    filename = f"qa_{payload['risk']}.txt"
    text_bytes = payload["text_body"].encode("utf-8")
    key, size, sha = storage.save_upload(
        material.id, 1, filename, _BytesIO(text_bytes)
    )
    version = MaterialVersion(
        material_id=material.id,
        version_no=1,
        storage_key=key,
        original_filename=filename,
        mime_type="text/plain",
        file_size=size,
        checksum=sha,
        text_body=payload["text_body"],
        extra={"risk_label": payload["risk"]},
        created_by_id=submitter.id,
    )
    db.add(version)
    await db.flush()
    material.current_version_id = version.id
    return material


async def _create_non_text_material(
    db: AsyncSession, submitter: User, payload: dict
) -> Material:
    """Create a non-text material WITHOUT writing a real file.

    ``storage_key`` is set to a placeholder path; the file does not exist on
    disk, so the download endpoint will fail for these materials.
    """
    material = Material(
        title=payload["title"],
        description=f"QA test data, risk: {payload['risk']}",
        material_type=payload["material_type"],
        status=MaterialStatus.DRAFT,
        tags={"risk": payload["risk"], "source": "seed_qa"},
        extra_metadata={
            "risk_label": payload["risk"],
            "placeholder": True,
            "placeholder_note": "no real file on disk; download not available",
        },
        submitter_id=submitter.id,
    )
    db.add(material)
    await db.flush()

    key = (
        f"materials/{material.id}/v1/placeholder.bin"
    )
    version = MaterialVersion(
        material_id=material.id,
        version_no=1,
        storage_key=key,
        original_filename=payload["original_filename"],
        mime_type=payload["mime_type"],
        file_size=0,
        checksum=None,
        text_body=None,
        extra={"risk_label": payload["risk"], "placeholder": True},
        created_by_id=submitter.id,
    )
    db.add(version)
    await db.flush()
    material.current_version_id = version.id
    return material


# ---------------------------------------------------------------------------
# Tiny in-memory binary IO
# ---------------------------------------------------------------------------


class _BytesIO:
    """Minimal file-like wrapper around bytes for storage.save_upload."""

    def __init__(self, data: bytes) -> None:
        self._buf = data
        self._pos = 0

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            chunk = self._buf[self._pos:]
            self._pos = len(self._buf)
            return chunk
        chunk = self._buf[self._pos : self._pos + size]
        self._pos += len(chunk)
        return chunk


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main() -> None:
    # Ensure storage dirs exist (idempotent, safe no-op if already created)
    from app.core.config import settings

    settings.ensure_storage_dirs()

    async with SessionLocal() as db:
        submitter = await _get_submitter(db)
        purged = await _purge_existing(db)
        if purged:
            print(f"purged {purged} existing __QA__ material(s)")

        # Need to flush + commit after purge so that IDs assigned to newly
        # created materials don't collide with deleted-but-cached ones.
        await db.commit()

        created: List[Material] = []

        for payload in TEXT_PAYLOADS:
            m = await _create_text_material(db, submitter, payload)
            created.append(m)

        for payload in NON_TEXT_PAYLOADS:
            m = await _create_non_text_material(db, submitter, payload)
            created.append(m)

        await db.commit()

        # ---- report ----
        print()
        print(
            f"{'ID':<5} {'TYPE':<7} {'RISK':<32} TITLE"
        )
        print("-" * 100)
        for m in created:
            risk = (m.tags or {}).get("risk", "")
            print(
                f"{m.id:<5} {m.material_type.value:<7} {risk:<32} {m.title}"
            )
        print()
        print(f"created {len(created)} QA material(s), all in status=draft")
        print("(download endpoint is only functional for text materials)")


async def _run() -> None:
    try:
        await main()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(_run())
