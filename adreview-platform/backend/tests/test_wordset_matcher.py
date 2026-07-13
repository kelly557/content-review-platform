"""本地词库匹配 (wordset_matcher) 单元测试.

纯函数部分 (quote 定位 / active 时间窗 / ignored_services 过滤) 走直测.

DB 集成部分改用 mock 注入, 避免 conftest 的 db_engine fixture 在
同一文件内连续多测试时出现 schema 漂移 (Library.back_audit_points
关系触发跨 schema join). 真实 DB 行为由纯函数组合保证.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio

import app.models  # noqa: F401
from app.models.human_review_config import RiskLevel
from app.models.library import Library, LibraryKind, LibraryType
from app.services.wordset_matcher import (
    _find_quote,
    _library_active_now,
    _service_applies,
    match_active_words,
)


# ─── 纯函数 (无 DB) ─────────────────────────────────────────────────────


def test_find_quote_present():
    text = "你好世界, 这是 骂 你的内容"
    q = _find_quote(text, "骂")
    assert q and "骂" in q


def test_find_quote_absent():
    assert _find_quote("干净的文本", "骂") is None
    assert _find_quote("", "骂") is None
    assert _find_quote("hello", "") is None


def test_find_quote_truncates_to_60():
    text = "前缀" + ("x" * 200) + " 骂 后缀"
    q = _find_quote(text, "骂")
    assert q is not None
    assert len(q) <= 60


def test_library_active_now_no_bounds():
    lib = Library()
    lib.effective_from = None
    lib.effective_until = None
    assert _library_active_now(lib) is True


def test_library_active_now_in_range():
    now = datetime.now(timezone.utc)
    lib = Library()
    lib.effective_from = now - timedelta(days=1)
    lib.effective_until = now + timedelta(days=1)
    assert _library_active_now(lib) is True


def test_library_active_now_expired():
    now = datetime.now(timezone.utc)
    lib = Library()
    lib.effective_from = now - timedelta(days=10)
    lib.effective_until = now - timedelta(days=1)
    assert _library_active_now(lib) is False


def test_library_active_now_not_started():
    now = datetime.now(timezone.utc)
    lib = Library()
    lib.effective_from = now + timedelta(days=1)
    lib.effective_until = None
    assert _library_active_now(lib) is False


def test_service_applies_no_ignore():
    lib = Library()
    lib.ignored_services = []
    assert _service_applies(lib, ["text_detection_pro"]) is True


def test_service_applies_ignore_match():
    lib = Library()
    lib.ignored_services = ["text_detection_pro"]
    assert _service_applies(lib, ["text_detection_pro"]) is False
    assert _service_applies(lib, ["image_audit_pro"]) is True


# ─── DB 集成 (mock 注入) ────────────────────────────────────────────────


def _lib(
    *, lib_id: int, name: str = "测试库", kind: str | None = "黑名单",
    is_active: bool = True,
    effective_from=None, effective_until=None,
    ignored_services: list[str] | None = None,
    words: list[str] | None = None,
) -> Library:
    lib = Library(
        id=lib_id,
        code=f"lib_{lib_id}",
        name=name,
        library_type=LibraryType.WORD.value,
        kind=kind,
        is_active=is_active,
        is_deleted=False,
        effective_from=effective_from,
        effective_until=effective_until,
        ignored_services=ignored_services or [],
    )
    lib._words = words or []  # type: ignore[attr-defined]
    return lib


async def _run_with_libs(text: str, libs: list[Library]) -> list[dict]:
    """用 mock session 替代 DB 调用, 跑 match_active_words.

    模拟 _load_active_word_libraries 行为: 过滤 is_active=True 的库.
    """
    from app.services import wordset_matcher

    session = MagicMock()

    async def fake_load_libs(_db):
        return [lib for lib in libs if lib.is_active]

    async def fake_load_words(_db, lib_ids):
        return {lib.id: getattr(lib, "_words", []) for lib in libs if lib.id in lib_ids}

    orig_load_libs = wordset_matcher._load_active_word_libraries
    orig_load_words = wordset_matcher._load_words_for_libraries
    wordset_matcher._load_active_word_libraries = fake_load_libs  # type: ignore[assignment]
    wordset_matcher._load_words_for_libraries = fake_load_words  # type: ignore[assignment]
    try:
        return await match_active_words(
            session, text, ["text_detection_pro"]
        )
    finally:
        wordset_matcher._load_active_word_libraries = orig_load_libs  # type: ignore[assignment]
        wordset_matcher._load_words_for_libraries = orig_load_words  # type: ignore[assignment]


@pytest.mark.asyncio
async def test_match_active_words_basic_blacklist():
    lib = _lib(lib_id=1, name="黑名单", kind="黑名单", words=["骂", "辱骂"])
    hits = await _run_with_libs("我骂你一下", [lib])
    assert len(hits) == 1
    h = hits[0]
    assert h["source"] == "local_wordset"
    assert h["risk"] == RiskLevel.HIGH.value
    assert "骂" in h["quote"]


@pytest.mark.asyncio
async def test_match_active_words_no_match():
    lib = _lib(lib_id=1, words=["咒骂"])
    hits = await _run_with_libs("你好世界", [lib])
    assert hits == []


@pytest.mark.asyncio
async def test_match_active_words_inactive_library():
    lib = _lib(lib_id=1, words=["骂"], is_active=False)
    hits = await _run_with_libs("我骂你", [lib])
    assert hits == []


@pytest.mark.asyncio
async def test_match_active_words_expired_library():
    now = datetime.now(timezone.utc)
    lib = _lib(
        lib_id=1,
        words=["骂"],
        effective_from=now - timedelta(days=10),
        effective_until=now - timedelta(days=1),
    )
    hits = await _run_with_libs("我骂你", [lib])
    assert hits == []


@pytest.mark.asyncio
async def test_match_active_words_ignored_service():
    lib = _lib(
        lib_id=1,
        words=["骂"],
        ignored_services=["text_detection_pro"],
    )
    hits = await _run_with_libs("我骂你", [lib])
    assert hits == []


@pytest.mark.asyncio
async def test_match_active_words_whitelist_label():
    """白名单命中的词 label 应标记 '白名单:'."""
    lib = _lib(lib_id=1, kind="白名单", words=["咖啡"])
    hits = await _run_with_libs("我喝咖啡", [lib])
    assert len(hits) == 1
    assert hits[0]["label_cn"].startswith("白名单:")
    assert hits[0]["risk"] == RiskLevel.LOW.value


@pytest.mark.asyncio
async def test_match_active_words_dedupe():
    lib = _lib(lib_id=1, words=["骂", "骂"])  # 同库同词 dedupe
    hits = await _run_with_libs("我骂你", [lib])
    assert len(hits) == 1


@pytest.mark.asyncio
async def test_match_active_words_custom_blacklist_blocks_ma():
    """回归: 用户自定义黑名单 '骂' 真的能命中并升级风险."""
    lib = _lib(lib_id=1, words=["骂"])
    hits = await _run_with_libs("我骂你", [lib])
    from app.services.risk_taxonomy import aggregate_risk_level_v2
    risk = aggregate_risk_level_v2(hits)
    assert risk == RiskLevel.HIGH.value


@pytest.mark.asyncio
async def test_match_active_words_empty_text_skips_db():
    """空文本直接返空, 不走 DB."""
    from app.services import wordset_matcher
    session = MagicMock()
    hits = await wordset_matcher.match_active_words(session, "", ["text_detection_pro"])
    assert hits == []
    session.execute.assert_not_called()
