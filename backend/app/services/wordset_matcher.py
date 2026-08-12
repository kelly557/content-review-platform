"""Local wordset matching: 在 LLM 调用前对 text_body 跑一轮本地黑名单匹配.

目标: 让用户在「库管理」里自定义的黑名单/白名单词条**真的**参与决策, 而
不是单纯依赖 LLM 是否识别为敏感词 (LLM 经常漏判或写错 label_cn).

匹配方式: substring (大小写敏感, 中文按字符). 性能: 走简单循环; 词条规模
< 10k 时单次审核 < 5ms. 大规模再切换 Aho-Corasick.

输出: hit dict 列表, 形态与 LLM hits 一致 (label/label_cn/quote/score/...) ,
    额外带 ``source="local_wordset"`` + ``library_id`` 供下游区分.

绑定标签: 一个词库/代答库允许绑定 1 个一级或二级风险标签 (level 1/2).
  - 没绑时: label_cn = "自定义黑名单库:<word>" / "自定义白名单库:<word>"
  - 绑了时: label_cn = "<tag.path>/自定义黑名单库:<word>" (例: "涉政/一级领导人/自定义黑名单库:xx")
  - hit dict 额外带 tag = {id, name, level, path} 供前端结构化处理.

调用: run_machine_review 在 call_llm_detection 之前先调 match_active_words,
    把 local_hits 合并到 llm_hits 之后, 再走 aggregate / suggest_action.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import and_, or_, select
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


# 不绑 tag 时使用的固定库类型文案 (用于 label_cn 的 "类型" 段)。
# 注意: 与 Library.kind 1:1 — 词库/图片库才有 kind,代答库无 kind 但走黑名单语义。
_LIBRARY_KIND_LABEL: Dict[str, str] = {
    LibraryKind.BLACKLIST.value: "自定义黑名单库",
    LibraryKind.WHITELIST.value: "自定义白名单库",
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
    library_ids: Optional[Iterable[int]] = None,
) -> List[Library]:
    """拉取所有启用的 word 库 (is_active=True, is_deleted=False).

    ``library_ids`` (可选) 用于策略联动: 传入时有效库 = 平台预置库
    (``is_platform=True``) ∪ ``library_ids``; 不传时维持旧行为 (全量启用库),
    供 run_machine_review 兼容.

    标签链 (含 parent) 走单独一条 query 批量加载, 避免 selectinload 嵌套触发的
    跨测试 schema 串号 (per-test schema isolation 已经在 conftest 处理;但
    loader cache 的失效时机不覆盖 selectinload 嵌套情况, 改用单独 query 更稳)。
    """
    stmt = select(Library).where(
        and_(
            Library.library_type == LibraryType.WORD.value,
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
            # 传了空集合: 仅平台库.
            stmt = stmt.where(Library.is_platform.is_(True))
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


async def _load_tag_briefs_for_libraries(
    db: AsyncSession, library_ids: List[int]
) -> Dict[int, Dict[str, Any]]:
    """批量拉取每个 library 绑定的首个有效 tag (level 1/2, 未软删除)。

    返回: {library_id: {id, name, level, path}}

    实现: 用一次自连接 (CTE) 一次性取出每个 tag 的完整 path,避免
    ORM lazy property 触发额外 query。同时绕开 selectinload 嵌套
    在某些 SA 缓存场景下跨测试 schema 串号的问题。
    """
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
            continue  # 一库一标签 (取 created_at 最早)
        by_lib[lib_id] = {
            "id": tag_id,
            "name": name,
            "level": int(level),
            "path": path or name,
        }
    return by_lib


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
    tag: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """根据 Library.kind 构造一条 hit dict.

    黑名单 -> 高风险; 白名单 -> 低风险 (语义上仅打标, 不参与升档);
    其它无 kind 视为黑名单处理.

    label_cn 拼接规则:
      - 不绑 tag  → "{库类型}:{word}" — 例: "自定义黑名单库:暴恐"
      - 绑了 tag  → "{tag.path}/{库类型}:{word}" — 例: "涉政/一级领导人/自定义黑名单库:暴恐"

    ``tag`` 是 dict (id/name/level/path),由 match_active_words 从
    library.tags 第一个未软删的 tag 派生;这里只读字段不操作 ORM。
    """
    if library.kind == LibraryKind.WHITELIST.value:
        kind_label = _LIBRARY_KIND_LABEL[LibraryKind.WHITELIST.value]
        risk = RiskLevel.LOW.value
    else:
        kind_label = _LIBRARY_KIND_LABEL[LibraryKind.BLACKLIST.value]
        risk = RiskLevel.HIGH.value
    label_cn = f"{tag['path']}/{kind_label}:{word}" if tag else f"{kind_label}:{word}"
    hit: Dict[str, Any] = {
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
    if tag is not None:
        hit["tag"] = tag
    return hit


async def match_active_words(
    db: AsyncSession,
    text: str,
    enabled_services: Iterable[str],
    library_ids: Optional[Iterable[int]] = None,
) -> List[Dict[str, Any]]:
    """在 text 中匹配所有启用的 word 库, 返回 hit 列表.

    enabled_services 用于过滤 lib.ignored_services; 但本地黑名单
    通常不绑 service, 所以这里只在 ignored 非空且**全屏蔽**时跳过.

    library_ids (可选) 用于策略联动: 传入时匹配范围 = 平台预置库 ∪
    指定 id (通常来自策略勾选审核点/项关联的 audit_point_libraries /
    audit_item_libraries); 不传时维持全量启用库的旧行为.
    """
    if not text or not text.strip():
        return []
    libs = await _load_active_word_libraries(db, library_ids=library_ids)
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
    tag_by_lib = await _load_tag_briefs_for_libraries(
        db, [lib.id for lib in active_libs]
    )
    hits: List[Dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()  # 防止同库同词重复
    for lib in active_libs:
        tag = tag_by_lib.get(lib.id)
        for word in words_by_lib.get(lib.id, []):
            key = (lib.id, word)
            if key in seen:
                continue
            quote = _find_quote(text, word)
            if quote is None:
                continue
            seen.add(key)
            hits.append(
                _build_hit(library=lib, word=word, quote=quote, tag=tag)
            )
    return hits
