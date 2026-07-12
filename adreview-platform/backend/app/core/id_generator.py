"""Public ID generator (UUID v7, time-sortable).

Project convention: every externally-referenced entity carries a
`public_id` (UUID v7, 36 chars hyphenated) in addition to its internal
integer surrogate PK. The integer PK stays for internal joins and FKs;
`public_id` is the value exchanged with the frontend / external
systems (URL paths in future phases, notifier payloads, audit-log
`entity_id` in future phases).

Phase 1 of the public_id rollout (see plan): add the column and expose
in response bodies only. No URL/behavior change yet.
"""
from __future__ import annotations

import uuid


def new_public_id() -> str:
    """Return a fresh UUID v7 as a 36-char hyphenated lowercase string.

    UUID v7 is time-ordered (first 48 bits = unix ms), so DB indexes
    on `public_id` retain insertion-order locality. Falls back to
    `uuid.uuid4()` if the runtime predates Python 3.14 (uuid7 was
    added in 3.14). This fallback should never trigger on supported
    deployments but keeps tests/dev environments on older Pythons
    working.
    """
    if hasattr(uuid, "uuid7"):
        return str(uuid.uuid7())
    return str(uuid.uuid4())
