"""Auto-generate resource codes: tk_/rs_/dr_/<timestamp>_<4-char random>.

Codes are server-side identifiers used in URLs and DB unique key.
Users see *name* not *code*; we still emit a code so internal links
and audit trails remain stable.
"""
from __future__ import annotations

import random
import re
import string
from datetime import datetime, timezone
_TRIGGER_CODE_RE = re.compile(r"^tk_[0-9]{8,14}_[0-9a-z]{4}$")
_RULESET_CODE_RE = re.compile(r"^rs_[0-9]{8,14}_[0-9a-z]{4}$")
_DISPOSITION_CODE_RE = re.compile(r"^dr_[0-9]{8,14}_[0-9a-z]{4}$")
_KNOWLEDGE_CODE_RE = re.compile(r"^kdoc_[0-9]{8,14}_[0-9a-z]{4}$")
_REGISTERED_MODEL_CODE_RE = re.compile(r"^mdl_[0-9]{8,14}_[0-9a-z]{4}$")


def _stamp_suffix(prefix: str, now: datetime | None = None) -> str:
    ts = now or datetime.now(timezone.utc)
    stamp = ts.strftime("%Y%m%d%H%M%S")
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
    return f"{prefix}{stamp}_{suffix}"



def generate_trigger_code(now: datetime | None = None) -> str:
    """Return a fresh trigger code: tk_<YYYYMMDDHHMMSS>_<4-char random>."""
    return _stamp_suffix("tk_", now)


def generate_rule_set_code(now: datetime | None = None) -> str:
    """Return a fresh rule_set code: rs_<YYYYMMDDHHMMSS>_<4-char random>."""
    return _stamp_suffix("rs_", now)


def generate_disposition_code(now: datetime | None = None) -> str:
    """Return a fresh disposition_rule code: dr_<YYYYMMDDHHMMSS>_<4-char random>."""
    return _stamp_suffix("dr_", now)


def generate_knowledge_document_code(now: datetime | None = None) -> str:
    """Return a fresh knowledge document code: kdoc_<timestamp>_<4-char random>."""
    return _stamp_suffix("kdoc_", now)


def generate_registered_model_code(now: datetime | None = None) -> str:
    """Return a fresh registered_model code: mdl_<YYYYMMDDHHMMSS>_<4-char random>."""
    return _stamp_suffix("mdl_", now)


def is_valid_trigger_code(s: str) -> bool:
    return bool(_TRIGGER_CODE_RE.match(s))


def is_valid_rule_set_code(s: str) -> bool:
    return bool(_RULESET_CODE_RE.match(s))


def is_valid_disposition_code(s: str) -> bool:
    return bool(_DISPOSITION_CODE_RE.match(s))


def is_valid_knowledge_document_code(s: str) -> bool:
    return bool(_KNOWLEDGE_CODE_RE.match(s))


def is_valid_registered_model_code(s: str) -> bool:
    return bool(_REGISTERED_MODEL_CODE_RE.match(s))

