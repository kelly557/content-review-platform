"""Auto-generate trigger codes: tk_<timestamp>_<4-char random>.

Codes are server-side identifiers used in URLs (webhook path) and
DB unique key. Users see *name* not *code*; we still emit a code
so internal links and audit trails remain stable.
"""
from __future__ import annotations

import random
import re
import string
from datetime import datetime, timezone

_CODE_RE = re.compile(r"^tk_[0-9]{8,14}_[0-9a-z]{4}$")


def generate_trigger_code(now: datetime | None = None) -> str:
    """Return a fresh, unique-looking code.

    Format: tk_<YYYYMMDDHHMMSS>_<4-char base32-ish>. Stays well
    inside the 64-char limit on triggers.code column.
    """
    ts = now or datetime.now(timezone.utc)
    stamp = ts.strftime("%Y%m%d%H%M%S")
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
    return f"tk_{stamp}_{suffix}"


def is_valid_trigger_code(s: str) -> bool:
    """Used by schemas: only allow generated-shape codes if user supplies."""
    return bool(_CODE_RE.match(s))
