"""Plain-text extraction for knowledge base documents.

Supports:
- application/pdf via pypdf (lazy import, optional dependency)
- text/plain / text/markdown via utf-8 decode with fallback

For very long documents, ``extract_with_chunks`` splits by double-newline
paragraphs and returns a list of chunks under a max-character budget.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional

log = logging.getLogger(__name__)


class TextExtractionError(Exception):
    pass


def _read_text_file(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8", "utf-8-sig", "gb18030", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _read_pdf_file(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise TextExtractionError(
            "pypdf is required to extract PDF; install backend/requirements.txt"
        ) from exc
    reader = PdfReader(str(path))
    parts: List[str] = []
    for i, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception as exc:  # noqa: BLE001
            log.warning("PDF page %d extract failed: %s", i, exc)
            text = ""
        if text:
            parts.append(text)
    return "\n\n".join(parts)


def extract_text(*, mime_type: str, storage_path: Path) -> str:
    """Extract plain text from a stored object based on its MIME type."""
    if not storage_path.is_file():
        raise TextExtractionError(f"file not found: {storage_path}")
    mt = (mime_type or "").lower()
    if mt == "application/pdf" or storage_path.suffix.lower() == ".pdf":
        return _read_pdf_file(storage_path)
    if mt in {"text/plain", "text/markdown", ""} or storage_path.suffix.lower() in {".txt", ".md"}:
        return _read_text_file(storage_path)
    raise TextExtractionError(f"unsupported mime for knowledge extraction: {mime_type}")


def chunk_by_paragraph(text: str, max_chars: int) -> List[str]:
    """Split text into chunks no larger than ``max_chars``, preferring paragraph breaks."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: List[str] = []
    buf: List[str] = []
    cur = 0
    for p in paragraphs:
        if cur + len(p) + 2 > max_chars and buf:
            chunks.append("\n\n".join(buf))
            buf = [p]
            cur = len(p)
        else:
            buf.append(p)
            cur += len(p) + 2
    if buf:
        chunks.append("\n\n".join(buf))
    return chunks