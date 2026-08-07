"""Encrypted credential helper. Token ciphertext is stored as TEXT.

Uses Fernet (AES-128 in CBC + HMAC-SHA256). Key is derived from
``settings.app_secret`` via HKDF so we never store the raw signing secret.

NOT a substitute for a proper secret manager; provided for the platform's
self-hosted use case where getting KMS out of the box is not feasible.
"""
from __future__ import annotations

import base64
import hashlib
from typing import Tuple

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

_KDF_INFO = b"adreview.credentials.v1"


def _fernet() -> Fernet:
    raw = settings.app_secret.encode("utf-8") or b"change-me"
    okm = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_KDF_INFO).derive(raw)
    return Fernet(base64.urlsafe_b64encode(okm))


def encrypt_token(token: str) -> str:
    return _fernet().encrypt(token.encode("utf-8")).decode("ascii")


def decrypt_token(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Invalid or rotated credential ciphertext") from exc


def mask_token(token: str) -> str:
    stripped = (token or "").strip()
    if not stripped:
        return ""
    # Avoid leaking full tokens to UI. Show prefix + 4 chars and len hint.
    if len(stripped) <= 8:
        return f"***{stripped[-2:]}"
    visible = 4
    masked = "*" * max(4, len(stripped) - visible - 2)
    return f"{stripped[:2]}{masked}{stripped[-visible:]}"


def derive_key_id(token: str) -> Tuple[str, int]:
    """Cheap fingerprint for audit/comparison logs; never returns token bytes."""
    h = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return h[:12], len(token)
