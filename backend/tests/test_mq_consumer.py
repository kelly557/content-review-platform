"""Tests for mq_consumer entry-point parsing + publish helper.

The Redis I/O loop itself requires a real broker; here we only validate the
piecewise behaviour that does not depend on a live connection:

  - ``publish()`` raises ``RuntimeError`` when redis is not installed
  - ``_process_entry`` shape parsing (called via ``publish``)
"""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_publish_raises_without_redis_package(monkeypatch):
    """If the redis package is missing, publish() must raise RuntimeError."""
    from app.services import mq_consumer

    monkeypatch.setattr(mq_consumer, "_redis_module", lambda: None)

    with pytest.raises(RuntimeError):
        await mq_consumer.publish([1, 2, 3])


@pytest.mark.asyncio
async def test_run_loop_exits_when_redis_missing(monkeypatch):
    """If redis isn't installed, run_loop() must return cleanly (no crash)."""
    import asyncio

    from app.services import mq_consumer

    monkeypatch.setattr(mq_consumer, "_redis_module", lambda: None)

    stop = asyncio.Event()
    # Should return without raising
    await mq_consumer.run_loop(stop)
    assert not stop.is_set()


@pytest.mark.asyncio
async def test_process_entry_drops_poison_pills():
    """An entry without a 'payload' field must be acked (return 0) and not crash."""
    from app.services import mq_consumer

    delivery_count = 0
    # No DB session needed — empty payload short-circuits before any DB call.
    code = await mq_consumer._process_entry(None, {}, delivery_count)  # type: ignore[arg-type]
    assert code == 0


@pytest.mark.asyncio
async def test_process_entry_drops_invalid_json():
    from app.services import mq_consumer

    code = await mq_consumer._process_entry(None, {"payload": "not-json"}, 0)  # type: ignore[arg-type]
    assert code == 0


@pytest.mark.asyncio
async def test_process_entry_drops_empty_material_ids():
    from app.services import mq_consumer

    import json
    payload = json.dumps({"material_ids": []})
    code = await mq_consumer._process_entry(None, {"payload": payload}, 0)  # type: ignore[arg-type]
    assert code == 0