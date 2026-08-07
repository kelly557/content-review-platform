"""In-memory background task registry.

Per spec: '任务队列：内存（文件转码、通知发送、报表生成）'.
Tasks fire-and-forget via asyncio.create_task - survives only the process lifetime.
For production, swap with ARQ/RQ/Celery.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

log = logging.getLogger(__name__)

TaskFn = Callable[..., Awaitable[Any]]
_tasks: list[asyncio.Task[Any]] = []


def spawn(coro_factory: Callable[[], Awaitable[Any]], name: str | None = None) -> asyncio.Task[Any]:
    """Schedule a coroutine to run in the background."""
    task = asyncio.create_task(coro_factory(), name=name)
    _tasks.append(task)
    task.add_done_callback(_drop_done)
    log.debug("spawned background task: %s", task.get_name())
    return task


def _drop_done(task: asyncio.Task[Any]) -> None:
    try:
        _tasks.remove(task)
    except ValueError:
        pass
    if task.cancelled():
        return
    exc = task.exception()
    if exc:
        log.exception("background task failed", exc_info=exc)


async def shutdown() -> None:
    for t in list(_tasks):
        t.cancel()
    for t in list(_tasks):
        try:
            await t
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
    _tasks.clear()


# --- Sample task implementations (stubs) ---

async def transcode_video(storage_key: str) -> None:
    log.info("transcoding video: %s", storage_key)
    await asyncio.sleep(0.5)  # placeholder
    log.info("transcode done: %s", storage_key)


async def generate_thumbnail(storage_key: str) -> None:
    log.info("thumbnail for: %s", storage_key)
    await asyncio.sleep(0.2)


async def send_notification(user_id: int, subject: str, body: str) -> None:
    log.info("notify user=%s subject=%s", user_id, subject)


async def generate_report(report_id: int) -> None:
    log.info("generating report: %s", report_id)
    await asyncio.sleep(0.5)
