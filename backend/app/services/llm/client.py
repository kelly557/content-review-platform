"""Async httpx wrapper around the Marketingforce MaaS chat-completions endpoint.

The endpoint is OpenAI-compatible by configuration
(``settings.maas_base_url`` + ``/v1/chat/completions``). The actual protocol is
discoverable from the MaaS gateway: if a future deployment uses a different
path or payload shape, only this file needs to change. Schema-level concerns
(strict JSON, retries) live here, not in the caller.

Design constraints
------------------
- Strict no-fallback: the caller decides whether to fall back. This client
  raises ``ModerationAPIError`` / ``ModerationTimeoutError`` and lets the
  caller in ``app.tasks.machine_review`` decide.
- Retries with exponential backoff (3 attempts, 2^attempt * 0.5s + jitter).
- Records every call (success or failure) via ``record_llm_call``.
- Truncates input text at ``settings.maas_max_text_chars`` before sending.
"""
from __future__ import annotations

import asyncio
import json
import random
import time
from typing import Any

import httpx

from app.core.config import settings
from app.core.logging import get_logger

from .audit import record_llm_call
from .parser import ModerationResult, parse_moderation_result
from .prompts import build_moderation_prompt

log = get_logger(__name__)


class ModerationAPIError(RuntimeError):
    """Raised when MaaS returns a non-retryable error (4xx, schema invalid, etc.)."""


class ModerationTimeoutError(ModerationAPIError):
    """Raised when MaaS times out (after retries exhausted)."""


class MaaSClient:
    """Thin async client for the MaaS ``/v1/chat/completions`` endpoint."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        timeout: int | None = None,
        max_retries: int = 2,
    ) -> None:
        self._base_url = (base_url or settings.maas_base_url).rstrip("/")
        self._api_key = api_key or settings.maas_api_key
        self._model = model or settings.maas_model
        self._timeout = float(timeout or settings.maas_timeout)
        self._max_retries = max_retries

    async def moderate(
        self,
        *,
        db,
        version_id: int | None,
        task_id: int | None,
        text_body: str,
        enabled_services: list[str],
        correlation_id: str,
        audit_points: list[dict] | None = None,
    ) -> tuple[ModerationResult, dict[str, Any]]:
        """Call MaaS, validate the JSON, and return (result, audit_meta).

        ``audit_meta`` includes latency/token counts/schema_valid for LlmCall.
        ``db`` is the AsyncSession used to persist the LlmCall audit row.
        Raises ``ModerationAPIError`` on any non-retryable failure.

        ``audit_points`` (可选) 是策略启用的审核点清单, 会注入 prompt 让
        大模型按真实规则判; 传 None 时 prompt 与旧版完全一致.
        """
        if not self._api_key:
            raise ModerationAPIError("MaaS api key not configured (MAAS_API_KEY=...)")

        system_msg, user_msg = build_moderation_prompt(
            text_body, enabled_services, audit_points=audit_points
        )
        # 构建合法 audit_point_code 集合, 供 parser 校验 LLM 输出.
        valid_ap_codes: set[str] | None = None
        if audit_points:
            valid_ap_codes = {(p.get("code") or "").strip() for p in audit_points if p.get("code")}
            if not valid_ap_codes:
                valid_ap_codes = None
        truncated = len(text_body) > settings.maas_max_text_chars
        input_chars = min(len(text_body), settings.maas_max_text_chars)

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
            "temperature": settings.maas_temperature,
            "max_tokens": settings.maas_max_tokens,
            "response_format": {"type": "json_object"},
        }

        url = f"{self._base_url}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "X-Correlation-Id": correlation_id,
        }

        token_in = token_out = 0
        schema_valid = False
        latency_ms = 0
        ok = False
        error: str | None = None

        try:
            start = time.monotonic()
            response_data = await self._call_with_retries(
                url, headers, payload, correlation_id=correlation_id
            )
            latency_ms = int((time.monotonic() - start) * 1000)

            content = self._extract_content(response_data)
            token_in = int(response_data.get("usage", {}).get("prompt_tokens", 0))
            token_out = int(response_data.get("usage", {}).get("completion_tokens", 0))

            result = parse_moderation_result(
                content,
                original_text=text_body,
                valid_audit_point_codes=valid_ap_codes,
            )
            schema_valid = True
            ok = True
            return result, {
                "ok": ok,
                "latency_ms": latency_ms,
                "token_in": token_in,
                "token_out": token_out,
                "schema_valid": schema_valid,
                "truncated": truncated,
                "input_chars": input_chars,
                "error": None,
            }
        except ModerationTimeoutError as exc:
            error = f"timeout: {exc}"
            raise
        except ModerationAPIError as exc:
            error = str(exc)
            raise
        except Exception as exc:
            error = f"unexpected: {exc!r}"
            raise ModerationAPIError(error) from exc
        finally:
            try:
                await record_llm_call(
                    db,
                    task_id=task_id,
                    version_id=version_id,
                    correlation_id=correlation_id,
                    ok=ok,
                    latency_ms=latency_ms,
                    token_in=token_in,
                    token_out=token_out,
                    schema_valid=schema_valid,
                    truncated=truncated,
                    input_chars=input_chars,
                    error=error,
                    model=self._model,
                )
            except Exception:
                # Audit failure must not mask the original exception.
                log.warning("LlmCall audit insert failed", exc_info=True)

    async def chat(
        self,
        *,
        db,
        messages: list[dict[str, Any]],
        temperature: float | None = None,
        max_tokens: int | None = None,
        correlation_id: str,
        response_format: dict[str, Any] | None = None,
        task_id: int | None = None,
        version_id: int | None = None,
    ) -> str:
        """通用对话调用 (非 moderation): 返回 content 字符串.

        复用 ``_call_with_retries`` (重试退避) + ``record_llm_call`` (审计落库).
        供智能体在线测试 / AI 优化提示词 / 文档解析审核点 等通用场景使用.

        与 ``moderate`` 的区别: 调用方自己组装 messages (system+user), 不走
        moderation prompt; 返回原始 content 字符串, 不做 schema 校验.

        Raises ``ModerationAPIError`` on any non-retryable failure.
        """
        if not self._api_key:
            raise ModerationAPIError("MaaS api key not configured (MAAS_API_KEY=...)")

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "temperature": temperature if temperature is not None else settings.maas_temperature,
            "max_tokens": max_tokens if max_tokens is not None else settings.maas_max_tokens,
        }
        if response_format is not None:
            payload["response_format"] = response_format

        url = f"{self._base_url}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "X-Correlation-Id": correlation_id,
        }

        token_in = token_out = 0
        latency_ms = 0
        ok = False
        error: str | None = None
        input_chars = sum(len(m.get("content", "") or "") for m in messages)

        try:
            start = time.monotonic()
            response_data = await self._call_with_retries(
                url, headers, payload, correlation_id=correlation_id
            )
            latency_ms = int((time.monotonic() - start) * 1000)

            content = self._extract_content(response_data)
            token_in = int(response_data.get("usage", {}).get("prompt_tokens", 0))
            token_out = int(response_data.get("usage", {}).get("completion_tokens", 0))
            ok = True
            return content
        except ModerationTimeoutError as exc:
            error = f"timeout: {exc}"
            raise
        except ModerationAPIError as exc:
            error = str(exc)
            raise
        except Exception as exc:
            error = f"unexpected: {exc!r}"
            raise ModerationAPIError(error) from exc
        finally:
            try:
                await record_llm_call(
                    db,
                    task_id=task_id,
                    version_id=version_id,
                    correlation_id=correlation_id,
                    ok=ok,
                    latency_ms=latency_ms,
                    token_in=token_in,
                    token_out=token_out,
                    schema_valid=False,
                    truncated=False,
                    input_chars=input_chars,
                    error=error,
                    model=self._model,
                )
            except Exception:
                log.warning("LlmCall audit insert failed", exc_info=True)

    async def _call_with_retries(
        self,
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
        *,
        correlation_id: str,
    ) -> dict[str, Any]:
        attempt = 0
        last_exc: Exception | None = None
        while attempt <= self._max_retries:
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code == 429 or 500 <= resp.status_code < 600:
                    last_exc = ModerationAPIError(
                        f"HTTP {resp.status_code}: {resp.text[:200]}"
                    )
                    if attempt == self._max_retries:
                        raise last_exc from None
                    await self._sleep_backoff(attempt)
                    attempt += 1
                    continue
                if resp.status_code >= 400:
                    raise ModerationAPIError(
                        f"HTTP {resp.status_code}: {resp.text[:300]}"
                    )
                return resp.json()
            except httpx.TimeoutException as exc:
                last_exc = ModerationTimeoutError(f"timeout attempt {attempt}: {exc}")
                if attempt == self._max_retries:
                    raise last_exc from exc
                await self._sleep_backoff(attempt)
                attempt += 1
            except httpx.HTTPError as exc:
                raise ModerationAPIError(f"transport error: {exc}") from exc
        # Unreachable, but keep type checker happy.
        if last_exc:
            raise last_exc
        raise ModerationAPIError("retry loop exited without result")

    async def _sleep_backoff(self, attempt: int) -> None:
        delay = (2 ** attempt) * 0.5 + random.uniform(0, 0.2)
        await asyncio.sleep(delay)

    @staticmethod
    def _extract_content(response_data: dict[str, Any]) -> str:
        try:
            return response_data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ModerationAPIError(
                f"unexpected response shape (no choices[0].message.content): "
                f"{json.dumps(response_data)[:200]}"
            ) from exc
