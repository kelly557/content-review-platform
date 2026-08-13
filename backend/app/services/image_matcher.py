"""Local image library matching: 对上传图片算 sha256, 查图片库黑名单命中.

与 ``wordset_matcher`` 对称: wordset 走子串匹配, image 走 sha256 精确比对.
命中 → 高风险 hit dict (与 LLM hits 形态一致), 带 ``source="image_library"``.

库范围: 平台预置库 (is_platform=True) ∪ 策略关联 image 库 (library_ids 参数),
叠加 is_active / 未删除 / 生效区间 过滤.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.human_review_config import RiskLevel
from app.models.library import Library, LibraryType
from app.models.library_item import LibraryItem


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _library_active_now(lib: Library, *, now: Optional[datetime] = None) -> bool:
    """校验库在当前时间是否在 [effective_from, effective_until] 内."""
    moment = now or _now_utc()
    if lib.effective_from is not None and moment < lib.effective_from:
        return False
    if lib.effective_until is not None and moment > lib.effective_until:
        return False
    return True


async def _load_active_image_libraries(
    db: AsyncSession,
    library_ids: Optional[Iterable[int]] = None,
) -> List[Library]:
    """拉取启用的 image 库.

    library_ids (可选): 策略联动时有效库 = 平台预置库 ∪ 指定 id;
    不传时维持全量行为.
    """
    stmt = select(Library).where(
        and_(
            Library.library_type == LibraryType.IMAGE.value,
            Library.is_active.is_(True),
            Library.is_deleted.is_(False),
        )
    )
    if library_ids is not None:
        ids_set = [i for i in library_ids if i is not None]
        if ids_set:
            stmt = stmt.where(
                or_(
                    Library.is_platform.is_(True),
                    Library.id.in_(ids_set),
                )
            )
        else:
            stmt = stmt.where(Library.is_platform.is_(True))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def _load_image_items_by_sha(
    db: AsyncSession, library_ids: List[int], sha256: str
) -> List[LibraryItem]:
    """查指定库下 sha256 命中的图片条目."""
    if not library_ids or not sha256:
        return []
    stmt = select(LibraryItem).where(
        and_(
            LibraryItem.library_id.in_(library_ids),
            LibraryItem.sha256 == sha256,
            LibraryItem.is_deleted.is_(False),
        )
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def _load_tag_briefs_for_libraries(
    db: AsyncSession, library_ids: List[int]
) -> Dict[int, Dict[str, Any]]:
    """批量拉取每个 image 库绑定的首个有效 tag (level 1/2). 复用 wordset_matcher 的 CTE."""
    if not library_ids:
        return {}
    from sqlalchemy import text

    sql = text(
        """
        WITH RECURSIVE tag_path AS (
            SELECT id, name, level, parent_id, name::text AS path
              FROM tags
             WHERE parent_id IS NULL
            UNION ALL
            SELECT t.id, t.name, t.level, t.parent_id,
                   (tp.path || '/' || t.name) AS path
              FROM tags t
              JOIN tag_path tp ON t.parent_id = tp.id
        )
        SELECT lt.library_id, tp.id, tp.name, tp.level, tp.path
          FROM library_tags lt
          JOIN tag_path tp ON tp.id = lt.tag_id
         WHERE lt.library_id = ANY(:lib_ids)
           AND tp.level IN (1, 2)
           AND NOT EXISTS (
                SELECT 1 FROM tags t
                 WHERE t.id = lt.tag_id AND t.deleted_at IS NOT NULL
           )
          ORDER BY lt.created_at ASC
        """
    )
    rows = (await db.execute(sql, {"lib_ids": library_ids})).all()
    by_lib: Dict[int, Dict[str, Any]] = {}
    for lib_id, tag_id, name, level, path in rows:
        if lib_id in by_lib:
            continue
        by_lib[lib_id] = {
            "id": tag_id,
            "name": name,
            "level": int(level),
            "path": path or name,
        }
    return by_lib


def _build_hit(
    *,
    library: Library,
    sha256: str,
    tag: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """构造一条图片库命中 hit dict (与 wordset/LLM hits 形态一致)."""
    kind_label = "图片黑名单库"
    label_cn = f"{tag['path']}/{kind_label}" if tag else kind_label
    hit: Dict[str, Any] = {
        "service_code": "image_library",
        "service_name": library.name or "图片库",
        "label": f"image_library_{library.id}",
        "label_cn": label_cn,
        "score": 1.0,
        "quote": None,
        "bbox": None,
        "page": None,
        "timestamp_ms": None,
        "sensitive_grade": "S0",
        "risk": RiskLevel.HIGH.value,
        "source": "image_library",
        "library_id": library.id,
        "library_code": library.code,
        "matched_word": sha256[:16],
    }
    if tag is not None:
        hit["tag"] = tag
    return hit


def compute_sha256_from_bytes(content: bytes) -> str:
    """对图片字节算 sha256."""
    return hashlib.sha256(content).hexdigest()


def decode_base64_to_bytes(b64: str) -> bytes:
    """解码 base64 (兼容 data:image/...;base64, 前缀)."""
    import base64

    s = b64.strip()
    if s.startswith("data:"):
        # data:image/jpeg;base64,/9j/...
        idx = s.find(",")
        if idx > 0:
            s = s[idx + 1 :]
    return base64.b64decode(s)


async def match_active_images(
    db: AsyncSession,
    image_bytes: bytes,
    library_ids: Optional[Iterable[int]] = None,
) -> List[Dict[str, Any]]:
    """对图片字节算 sha256, 查图片库命中, 返回 hit 列表.

    library_ids (可选): 策略联动时有效库 = 平台库 ∪ 指定 id; 不传时全量.
    """
    if not image_bytes:
        return []
    sha = compute_sha256_from_bytes(image_bytes)
    libs = await _load_active_image_libraries(db, library_ids=library_ids)
    if not libs:
        return []
    moment = _now_utc()
    active_libs = [lib for lib in libs if _library_active_now(lib, now=moment)]
    if not active_libs:
        return []
    lib_id_list = [lib.id for lib in active_libs]
    tag_by_lib = await _load_tag_briefs_for_libraries(db, lib_id_list)
    hits: List[Dict[str, Any]] = []
    for lib in active_libs:
        items = await _load_image_items_by_sha(db, [lib.id], sha)
        if not items:
            continue
        tag = tag_by_lib.get(lib.id)
        hits.append(_build_hit(library=lib, sha256=sha, tag=tag))
    return hits
