"""本地词库匹配 (wordset_matcher) 单元测试.

需要 PostgreSQL (复用 conftest 的 db_engine fixture).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

import app.models  # noqa: F401
from app.models.human_review_config import RiskLevel
from app.models.library import Library, LibraryKind, LibraryType
from app.models.library_item import LibraryItem
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


# ─── DB 集成 (需要 PG) ──────────────────────────────────────────────────


@pytest_asyncio.fixture
async def make_word_library(db_engine):
    """工厂: 创建一个 word 库 + 若干词条, 返回 library 对象."""
    created: list[Library] = []

    async def _factory(*, words: list[str], kind: str = "黑名单",
                      is_active: bool = True,
                      effective_from=None, effective_until=None,
                      ignored_services: list[str] | None = None) -> Library:
        from app.db.session import async_sessionmaker
        maker = async_sessionmaker(db_engine, expire_on_commit=False)
        async with maker() as session:
            lib = Library(
                code=f"lib_{len(created)}",
                name=f"测试库-{len(created)}",
                library_type=LibraryType.WORD.value,
                kind=kind,
                is_active=is_active,
                is_deleted=False,
                effective_from=effective_from,
                effective_until=effective_until,
                ignored_services=ignored_services or [],
            )
            session.add(lib)
            await session.flush()
            for w in words:
                session.add(LibraryItem(library_id=lib.id, word=w))
            await session.commit()
            await session.refresh(lib)
            created.append(lib)
            return lib

    yield _factory

    # cleanup
    from app.db.session import async_sessionmaker
    maker = async_sessionmaker(db_engine, expire_on_commit=False)
    async with maker() as session:
        for lib in created:
            await session.refresh(lib)
            for item in lib.items:
                await session.delete(item)
            await session.delete(lib)
        await session.commit()


@pytest.mark.asyncio
async def test_match_active_words_basic_blacklist(make_word_library, db_engine):
    """基本黑名单: 文本含词条, 应生成 hit."""
    from app.db.session import async_sessionmaker

    await make_word_library(words=["骂", "辱骂"])
    maker = async_sessionmaker(db_engine, expire_on_commit=False)
    async with maker() as session:
        hits = await match_active_words(
            session, "我骂你一下", ["text_detection_pro"]
        )
    assert len(hits) == 1
    h = hits[0]
    assert h["source"] == "local_wordset"
    assert h["risk"] == RiskLevel.HIGH.value
    assert "骂" in h["quote"]


@pytest.mark.asyncio
async def test_match_active_words_no_match(make_word_library, db_engine):
    from app.db.session import async_sessionmaker
    await make_word_library(words=["咒骂"])
    maker = async_sessionmaker(db_engine, expire_on_commit=False)
    async with maker() as session:
        hits = await match_active_words(
            session, "你好世界", ["text_detection_pro"]
        )
    assert hits == []


@pytest.mark.asyncio
async def test_match_active_words_inactive_library(make_word_library, db_engine):
    from app.db.session import async_sessionmaker
    await make_word_library(words=["骂"], is_active=False)
    maker = async_sessionmaker(db_engine, expire_on_commit=False)
    async with maker() as session:
        hits = await match_active_words(
            session, "我骂你", ["text_detection_pro"]
        )
    assert hits == []


@pytest.mark.asyncio
async def test_match_active_words_expired_library(make_word_library, db_engine):
    from app.db.session import async_sessionmaker
    now = datetime.now(timezone.utc)
    await make_word_library(
        words=["骂"],
        effective_from=now - timedelta(days=10),
        effective_until=now - timedelta(days=1),
    )
    maker = async_sessionmaker(db_engine, expire_on_commit=False)
    async with maker() as session:
        hits = await match_active_words(
            session, "我骂你", ["text_detection_pro"]
        )
    assert hits == []


@pytest.mark.asyncio
async def test_match_active_words_ignored_service(make_word_library, db_engine):
    from app.db.session import async_sessionmaker
    await make_word_library(words=["骂"], ignored_services=["text_detection_pro"])
    maker = async_sessionmaker(db_engine, expire_on_commit=False)
    async with maker() as session:
        hits = await match_active_words(
            session, "我骂你", ["text_detection_pro"]
        )
    assert hits == []


@pytest.mark.asyncio
async def test_match_active_words_whitelist_label(make_word_library, db_engine):
    """白名单命中的词 label 应标记 '白名单:'."""
    from app.db.session import async_sessionmaker
    await make_word_library(words=["咖啡"], kind="白名单")
    maker = async_sessionmaker(db_engine, expire_on_commit=False)
    async with maker() as session:
        hits = await match_active_words(
            session, "我喝咖啡", ["text_detection_pro"]
        )
    assert len(hits) == 1
    assert hits[0]["label_cn"].startswith("白名单:")
    assert hits[0]["risk"] == RiskLevel.LOW.value


@pytest.mark.asyncio
async def test_match_active_words_dedupe(make_word_library, db_engine):
    from app.db.session import async_sessionmaker
    await make_word_library(words=["骂", "骂"])  # 同库同词 dedupe
    maker = async_sessionmaker(db_engine, expire_on_commit=False)
    async with maker() as session:
        hits = await match_active_words(
            session, "我骂你", ["text_detection_pro"]
        )
    assert len(hits) == 1
