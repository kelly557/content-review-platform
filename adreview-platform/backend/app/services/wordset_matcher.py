"""Local wordset matching: 在 LLM 调用前对 text_body 跑一轮本地黑名单匹配.

目标: 让用户在「库管理」里自定义的黑名单/白名单词条**真的**参与决策, 而
不是单纯依赖 LLM 是否识别为敏感词 (LLM 经常漏判或写错 label_cn).

匹配方式: substring (大小写敏感, 中文按字符). 性能: 走简单循环; 词条规模
< 10k 时单次审核 < 5ms. 大规模再切换 Aho-Corasick.

输出: hit dict 列表, 形态与 LLM hits 一致 (label/label_cn/quote/score/...) ,
    额外带 ``source="local_wordset"`` + ``library_id`` 供下游区分.

调用: run_machine_review 在 call_llm_detection 之前先调 match_active_words,
    把 local_hits 合并到 llm_hits 之后, 再走 aggregate / suggest_action.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.human_review_config import RiskLevel
from app.models.library import Library, LibraryKind, LibraryType
from app.models.library_item import LibraryItem


# 本地词库命中时使用的高风险等级 (按 Library.action 映射).
# 黑名单 -> 高风险; 需复审 -> 中风险; 标签 -> 低风险; 白名单单独走白名单处理.
_ACTION_TO_RISK: Dict[str, str] = {
    "黑名单": RiskLevel.HIGH.value,
    "需复审": RiskLevel.MEDIUM.value,
    "标签": RiskLevel.LOW.value,
}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _library_active_now(
    lib: Library, *, now: Optional[datetime] = None
) -> bool:
    """校验库在当前时间是否在 [effective_from, effective_until] 内."""
    moment = now or _now_utc()
    if lib.effective_from is not None:
        # 库存的是 tz-aware UTC; moment 同样 tz-aware.
        if moment < lib.effective_from:
            return False
    if lib.effective_until is not None:
        if moment > lib.effective_until:
            return False
    return True


def _service_applies(
    lib: Library, enabled_services: Iterable[str]
) -> bool:
    """检查 enabled_services 是否被 lib.ignored_services 屏蔽."""
    ignored = lib.ignored_services or []
    if not ignored:
        return True
    for svc in enabled_services:
        if svc in ignored:
            return False
    return True


async def _load_active_word_libraries(
    db: AsyncSession,
) -> List[Library]:
    """拉取所有启用的 word 库 (is_active=True, is_deleted=False)."""
    stmt = select(Library).where(
        and_(
            Library.library_type == LibraryType.WORD.value,
            Library.is_active.is_(True),
            Library.is_deleted.is_(False),
        )
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def _load_words_for_libraries(
    db: AsyncSession, library_ids: List[int]
) -> Dict[int, List[str]]:
    """批量拉取所有 (非删) 词条, 按 library_id 分组."""
    if not library_ids:
        return {}
    stmt = select(LibraryItem.library_id, LibraryItem.word).where(
        and_(
            LibraryItem.library_id.in_(library_ids),
            LibraryItem.is_deleted.is_(False),
            LibraryItem.word.isnot(None),
        )
    )
    rows = (await db.execute(stmt)).all()
    grouped: Dict[int, List[str]] = {lid: [] for lid in library_ids}
    for library_id, word in rows:
        if word and word.strip():
            grouped.setdefault(library_id, []).append(word)
    return grouped


def _find_quote(text: str, word: str) -> Optional[str]:
    """定位 word 在 text 中的真实子串, 返回第一次出现的位置切片 (≤60 字).

    中文 substring 走 str 自身包含即可, 无需 re.
    """
    if not text or not word:
        return None
    idx = text.find(word)
    if idx < 0:
        return None
    # 截取至多 60 字, 包含命中词
    end = min(len(text), idx + len(word) + 30)
    snippet = text[idx:end]
    return snippet[:60]


def _build_hit(
    *,
    library: Library,
    word: str,
    quote: str,
) -> Dict[str, Any]:
    """根据 Library.kind 构造一条 hit dict.

    黑名单 -> 高风险; 白名单 -> 低风险 (语义上仅打标, 不参与升档);
    其它无 kind 视为黑名单处理.
    """
    if library.kind == LibraryKind.WHITELIST.value:
        label_cn = f"白名单:{word}"
        risk = RiskLevel.LOW.value
    else:
        label_cn = f"自定义黑名单:{word}"
        risk = RiskLevel.HIGH.value
    return {
        "service_code": "local_wordset",
        "service_name": library.name or "本地词库",
        "label": f"local_wordset_{library.id}",
        "label_cn": label_cn,
        "score": 1.0,
        "quote": quote,
        "bbox": None,
        "page": None,
        "timestamp_ms": None,
        "sensitive_grade": "S0",
        "risk": risk,
        "source": "local_wordset",
        "library_id": library.id,
        "library_code": library.code,
        "matched_word": word,
    }


async def match_active_words(
    db: AsyncSession,
    text: str,
    enabled_services: Iterable[str],
) -> List[Dict[str, Any]]:
    """在 text 中匹配所有启用的 word 库, 返回 hit 列表.

    enabled_services 用于过滤 lib.ignored_services; 但本地黑名单
    通常不绑 service, 所以这里只在 ignored 非空且**全屏蔽**时跳过.
    """
    if not text or not text.strip():
        return []
    libs = await _load_active_word_libraries(db)
    if not libs:
        return []
    moment = _now_utc()
    active_libs = [
        lib
        for lib in libs
        if _library_active_now(lib, now=moment)
        and _service_applies(lib, enabled_services)
    ]
    if not active_libs:
        return []
    words_by_lib = await _load_words_for_libraries(
        db, [lib.id for lib in active_libs]
    )
    hits: List[Dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()  # 防止同库同词重复
    for lib in active_libs:
        for word in words_by_lib.get(lib.id, []):
            key = (lib.id, word)
            if key in seen:
                continue
            quote = _find_quote(text, word)
            if quote is None:
                continue
            seen.add(key)
            hits.append(_build_hit(library=lib, word=word, quote=quote))
    return hits
