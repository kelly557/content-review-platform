"""Unit tests for the LLM module: parser, prompt builder, client retries.

These tests don't talk to the network. The MaaSClient is exercised via
httpx.MockTransport so retry/backoff behavior is verified deterministically.
"""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.services.llm.client import (
    MaaSClient,
    ModerationAPIError,
    ModerationTimeoutError,
)
from app.services.llm.parser import (
    ModerationParseError,
    _quote_appears_in,
    parse_moderation_result,
)
from app.services.llm.prompts import build_moderation_prompt


# ----------------------------------------------------------------------------
# parser tests
# ----------------------------------------------------------------------------


def test_parse_happy_path():
    raw = json.dumps(
        {
            "risk_level": "高风险",
            "sensitive_level": "S3",
            "hits": [
                {
                    "service_code": "text_detection_pro",
                    "service_name": "通用文本审核",
                    "label": "medical_absolute_claim",
                    "label_cn": "医疗绝对化宣称",
                    "score": 0.92,
                    "quote": "本产品是最好的保健品",
                    "sensitive_grade": "S3",
                }
            ],
            "rule_hits": [
                {
                    "rule_id": 1,
                    "label": "medical_absolute_claim",
                    "label_cn": "医疗绝对化宣称",
                    "threshold": 0.5,
                    "matched": True,
                    "sensitive_grade": "S3",
                }
            ],
            "summary": "命中医疗绝对化宣称 1 条",
        },
        ensure_ascii=False,
    )
    text = "本产品是最好的保健品，3 天根治失眠"
    result = parse_moderation_result(raw, original_text=text)
    assert result.risk_level == "高风险"
    assert result.sensitive_level == "S3"
    assert len(result.hits) == 1
    assert result.hits[0].quote == "本产品是最好的保健品"
    assert result.hits[0].score == 0.92
    assert result.summary == "命中医疗绝对化宣称 1 条"


def test_parse_quote_not_in_text_is_dropped():
    raw = json.dumps(
        {
            "risk_level": "高风险",
            "hits": [
                {
                    "service_code": "text_detection_pro",
                    "label": "x",
                    "label_cn": "虚构引用",
                    "score": 0.9,
                    "quote": "THIS STRING DOES NOT EXIST IN THE TEXT",
                }
            ],
        },
        ensure_ascii=False,
    )
    result = parse_moderation_result(raw, original_text="正常文字")
    # Hit survives but quote is nulled to defend against fabricated evidence.
    assert len(result.hits) == 1
    assert result.hits[0].quote is None


def test_parse_invalid_sensitive_grade_falls_back_to_s0():
    raw = json.dumps(
        {
            "risk_level": "低风险",
            "hits": [
                {
                    "service_code": "text_detection_pro",
                    "label": "x",
                    "label_cn": "测试",
                    "score": 0.7,
                    "sensitive_grade": "S9",  # invalid
                }
            ],
        },
        ensure_ascii=False,
    )
    result = parse_moderation_result(raw, original_text="测试文本")
    assert result.hits[0].sensitive_grade == "S0"


def test_parse_tolerates_markdown_fences():
    raw = "```json\n" + json.dumps(
        {"risk_level": "无风险", "hits": [], "summary": "无命中"}
    ) + "\n```"
    result = parse_moderation_result(raw, original_text="无")
    assert result.risk_level == "无风险"
    assert result.hits == []


def test_parse_rejects_non_object():
    with pytest.raises(ModerationParseError):
        parse_moderation_result("[1,2,3]", original_text="x")


def test_quote_appears_in_strips_quotes_and_whitespace():
    text = "本产品 100% 安全。立即下单！"
    assert _quote_appears_in("“本产品 100% 安全”", text) is True
    assert _quote_appears_in("虚构", text) is False
    assert _quote_appears_in("", text) is False
    assert _quote_appears_in("abc", "") is False


# ----------------------------------------------------------------------------
# prompt builder tests
# ----------------------------------------------------------------------------


def test_prompt_includes_text_and_services():
    body = "本产品是最好的保健品。" * 10
    system, user = build_moderation_prompt(body, ["text_detection_pro"])
    assert "AdReview" in system
    assert body in user
    assert "text_detection_pro" in user
    assert "通用文本审核" in user


def test_prompt_truncates_oversize_text():
    long_body = "x" * 20000
    _system, user = build_moderation_prompt(long_body, [])
    assert len(user) < 13000
    assert "[…原文已截断" in user


# ----------------------------------------------------------------------------
# MaaSClient retry tests (httpx MockTransport)
# ----------------------------------------------------------------------------


def _ok_payload(content: str) -> dict:
    return {
        "choices": [{"message": {"content": content}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    }


@pytest.mark.asyncio
async def test_client_retries_then_succeeds(monkeypatch):
    monkeypatch.setenv("MAAS_API_KEY", "test-key")
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] < 3:
            return httpx.Response(503, text="boom")
        return httpx.Response(
            200, json=_ok_payload(json.dumps({"risk_level": "无风险", "hits": []}))
        )

    transport = httpx.MockTransport(handler)
    client = MaaSClient(max_retries=2, timeout=5)
    import app.services.llm.client as client_mod

    orig = httpx.AsyncClient

    class PatchedAsyncClient(orig):
        def __init__(self, *a, **kw):
            kw["transport"] = transport
            super().__init__(*a, **kw)

    client_mod.httpx.AsyncClient = PatchedAsyncClient
    try:
        # Backoff is 0.5 * 2^n + jitter[0, 0.2]. Don't actually sleep — just
        # verify the bounds by mocking the sleeper.
        # Patch _sleep_backoff to a no-op for this assertion-only branch.
        async def _no_sleep(_attempt: int) -> None:
            return None

        client._sleep_backoff = _no_sleep  # type: ignore[assignment]

        # Will fail twice, then succeed.
        result = await client._call_with_retries(
            "http://example/", {}, {}, correlation_id="cid"
        )
        assert "choices" in result
        assert attempts["n"] == 3  # 2 failures + 1 success
    finally:
        client_mod.httpx.AsyncClient = orig


@pytest.mark.asyncio
async def test_client_raises_timeout_error_after_retries_exhausted(monkeypatch):
    monkeypatch.setenv("MAAS_API_KEY", "test-key")

    client = MaaSClient(max_retries=1, timeout=1)

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException(
            "timeout", request=request
        )

    transport = httpx.MockTransport(handler)
    import app.services.llm.client as client_mod

    orig = httpx.AsyncClient

    class PatchedAsyncClient(orig):
        def __init__(self, *a, **kw):
            kw["transport"] = transport
            super().__init__(*a, **kw)

    client_mod.httpx.AsyncClient = PatchedAsyncClient
    try:
        with pytest.raises(ModerationTimeoutError):
            await client._call_with_retries(
                "http://example/", {}, {}, correlation_id="cid"
            )
    finally:
        client_mod.httpx.AsyncClient = orig


@pytest.mark.asyncio
async def test_client_raises_api_error_on_4xx(monkeypatch):
    monkeypatch.setenv("MAAS_API_KEY", "test-key")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, text="bad request body")

    # Run the retry path on the current event loop rather than spinning up
    # a fresh one (Python 3.14 stopped allowing the latter inside tests).
    client = MaaSClient(max_retries=0, timeout=1)
    transport = httpx.MockTransport(handler)

    # Monkeypatch httpx.AsyncClient at module scope so MaaSClient picks it up.
    import app.services.llm.client as client_mod

    orig = httpx.AsyncClient

    class PatchedAsyncClient(orig):
        def __init__(self, *a, **kw):
            kw["transport"] = transport
            super().__init__(*a, **kw)

    client_mod.httpx.AsyncClient = PatchedAsyncClient
    try:
        with pytest.raises(ModerationAPIError):
            await client._call_with_retries(
                "http://example/", {}, {}, correlation_id="cid"
            )
    finally:
        client_mod.httpx.AsyncClient = orig
