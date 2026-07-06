"""Upload helpers: infer MaterialType from mime, derive a default title, batch limits."""
from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Optional

from app.models.material import MaterialType

MAX_BATCH_FILES = 20

_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_VIDEO_MIMES = {"video/mp4", "video/quicktime"}
_PDF_MIMES = {"application/pdf"}
_TEXT_MIMES = {"text/plain"}

_EXT_TYPE_MAP = {
    ".jpg": MaterialType.IMAGE, ".jpeg": MaterialType.IMAGE,
    ".png": MaterialType.IMAGE, ".webp": MaterialType.IMAGE, ".gif": MaterialType.IMAGE,
    ".mp4": MaterialType.VIDEO, ".mov": MaterialType.VIDEO,
    ".pdf": MaterialType.PDF,
    ".txt": MaterialType.TEXT, ".md": MaterialType.TEXT,
}


def infer_material_type(mime: Optional[str], filename: Optional[str] = None) -> Optional[MaterialType]:
    """Map mime/extension to a MaterialType. Returns None when unknown."""
    if mime:
        m = mime.lower()
        if m in _IMAGE_MIMES:
            return MaterialType.IMAGE
        if m in _VIDEO_MIMES:
            return MaterialType.VIDEO
        if m in _PDF_MIMES:
            return MaterialType.PDF
        if m in _TEXT_MIMES:
            return MaterialType.TEXT
    if filename:
        ext = Path(filename).suffix.lower()
        if ext in _EXT_TYPE_MAP:
            return _EXT_TYPE_MAP[ext]
    return None


def infer_mime_from_filename(filename: Optional[str]) -> Optional[str]:
    """Best-effort mime guess from filename extension when browser sends octet-stream."""
    if not filename:
        return None
    guess, _ = mimetypes.guess_type(filename)
    return guess


def infer_title(filename: Optional[str], fallback_index: int) -> str:
    """Derive a human-readable title from filename. Falls back to `untitled-{n}`."""
    if not filename:
        return f"untitled-{fallback_index}"
    stem = Path(filename).stem.strip()
    if not stem:
        return f"untitled-{fallback_index}"
    cleaned = stem.replace("_", " ").strip()
    return cleaned[:255] or f"untitled-{fallback_index}"