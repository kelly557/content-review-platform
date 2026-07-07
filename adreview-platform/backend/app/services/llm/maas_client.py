"""MaaS LLM client (OpenAI-compatible /chat/completions).

Reconstructs the missing maas_client.py. Talks to settings.maas_base_url with
Authorization: Bearer <maas_api_key>. Supports two response_format modes:

- ``json_schema`` (default): strict OpenAI structured output
- ``json_object``: legacy JSON mode; relies on prompt to enforce schema

When ``settings.maas_enabled`` is False the client raises ``MaaSDisabledError``
so callers can take a no-op / mock path.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)


class MaaSError(Exception):
    """Raised on any non-recoverable MaaS error (HTTP, parse, schema)."""


class MaaSDisabledError(MaaSError):
    """Raised when MaaS is disabled via MAAS_ENABLED=false."""


class MaaSClient:
    """Thin async wrapper for the MaaS chat/completions endpoint."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout: Optional[int] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        response_mode: Optional[str] = None,
    ) -> None:
        self._base = (base_url or settings.maas_base_url).rstrip("/")
        self._api_key = api_key or settings.maas_api_key
        self._model = model or settings.maas_model
        self._timeout = int(timeout or settings.maas_timeout)
        self._max_tokens = int(max_tokens or settings.maas_max_tokens)
        self._temperature = float(
            temperature if temperature is not None else settings.maas_temperature
        )
        self._response_mode = (response_mode or settings.maas_response_mode or "json_schema").lower()
        self._enabled = bool(settings.maas_enabled) and bool(self._api_key)

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def model(self) -> str:
        return self._model

    async def chat_json(
        self,
        *,
        system: str,
        user: str,
        schema: Dict[str, Any],
        schema_name: str = "KnowledgeExtraction",
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Call chat/completions and return parsed JSON.

        ``schema`` is only used when ``response_mode == 'json_schema'``.
        For ``json_object`` mode the prompt is expected to enforce the shape.
        """
        if not self._enabled:
            raise MaaSDisabledError("MAAS is disabled or MAAS_API_KEY is not set")

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

        payload: Dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "temperature": float(
                temperature if temperature is not None else self._temperature
            ),
            "max_tokens": int(max_tokens or self._max_tokens),
        }

        if self._response_mode == "json_schema":
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "schema": schema, "strict": True},
            }
        else:
            payload["response_format"] = {"type": "json_object"}

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        url = f"{self._base}/chat/completions"
        log.info("MaaS request: model=%s mode=%s", self._model, self._response_mode)
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise MaaSError(f"MaaS HTTP error: {exc.__class__.__name__}: {exc}") from exc

        if resp.status_code >= 400:
            snippet = resp.text[:300] if resp.text else ""
            raise MaaSError(
                f"MaaS HTTP {resp.status_code}: {snippet}"
            )

        try:
            data = resp.json()
        except json.JSONDecodeError as exc:
            raise MaaSError(f"MaaS returned non-JSON envelope: {exc}") from exc

        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise MaaSError(f"MaaS response missing choices[0].message.content: {exc}") from exc

        if isinstance(content, str):
            try:
                return json.loads(content)
            except json.JSONDecodeError as exc:
                raise MaaSError(f"MaaS content not valid JSON: {exc}") from exc
        if isinstance(content, dict):
            return content
        raise MaaSError(f"MaaS unexpected content type: {type(content).__name__}")


_singleton: Optional[MaaSClient] = None


def get_maas_client() -> MaaSClient:
    global _singleton
    if _singleton is None:
        _singleton = MaaSClient()
    return _singleton