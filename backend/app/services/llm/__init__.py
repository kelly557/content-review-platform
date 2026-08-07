"""LLM client + schema + parser + prompts for the AI moderation pipeline.

Public surface
--------------
- ``MaaSClient``: async httpx wrapper around the Marketingforce MaaS endpoint.
- ``ModerationResult``: Pydantic schema for the LLM-returned JSON.
- ``parse_moderation_result``: validate the raw JSON against the schema and
  normalize it for downstream consumers.
- ``build_moderation_prompt``: turn a (text, services) tuple into a strict
  (system, user) prompt pair that asks for JSON conforming to ``ModerationResult``.
- ``record_llm_call``: persist an LlmCall audit row.

The MaaS endpoint is the **sole** moderation source. Callers in
``app.tasks.machine_review`` raise a hard ``RuntimeError`` (caller-catches
in ``run_machine_review`` persists the failure into ``machine_result``) when
``MAAS_API_KEY`` is unset — silent fallback to a placeholder is no longer
acceptable.
"""
from __future__ import annotations

from app.core.logging import get_logger

from .audit import record_llm_call
from .client import MaaSClient, ModerationAPIError, ModerationTimeoutError
from .parser import ModerationResult, parse_moderation_result
from .prompts import build_moderation_prompt

log = get_logger(__name__)

__all__ = [
    "MaaSClient",
    "ModerationResult",
    "ModerationAPIError",
    "ModerationTimeoutError",
    "build_moderation_prompt",
    "parse_moderation_result",
    "record_llm_call",
]
