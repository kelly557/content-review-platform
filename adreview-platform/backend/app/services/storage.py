"""Local filesystem storage for uploaded media."""
from __future__ import annotations

import hashlib
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import BinaryIO

from app.core.config import settings


class StorageError(Exception):
    pass


def _safe_key(material_id: int, version_no: int, original_filename: str) -> str:
    ext = Path(original_filename).suffix.lower()
    stamp = datetime.utcnow().strftime("%Y%m%d")
    return f"materials/{material_id}/v{version_no}/{stamp}{ext}"


def save_upload(material_id: int, version_no: int, original_filename: str, source: BinaryIO) -> tuple[str, int, str]:
    """Save an uploaded file. Returns (storage_key, size, sha256)."""
    settings.ensure_storage_dirs()
    if not original_filename:
        raise StorageError("filename required")

    key = _safe_key(material_id, version_no, original_filename)
    dest_path = settings.storage_root / "uploads" / key
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    sha = hashlib.sha256()
    size = 0
    with dest_path.open("wb") as out:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
            sha.update(chunk)
            size += len(chunk)

    if size > settings.storage_max_upload_mb * 1024 * 1024:
        dest_path.unlink(missing_ok=True)
        raise StorageError(f"file exceeds max size {settings.storage_max_upload_mb}MB")

    return key, size, sha.hexdigest()


def open_stream(storage_key: str) -> BinaryIO:
    path = settings.storage_root / "uploads" / storage_key
    if not path.is_file():
        raise StorageError("object not found")
    return path.open("rb")


def delete_object(storage_key: str) -> None:
    path = settings.storage_root / "uploads" / storage_key
    if path.is_file():
        path.unlink()


def _safe_image_key(set_id: int, sha: str, original_filename: str) -> str:
    ext = Path(original_filename).suffix.lower()
    if not ext:
        ext = ".bin"
    return f"imagesets/{set_id}/{sha[:8]}{ext}"


def save_image_upload(
    set_id: int, original_filename: str, source: BinaryIO
) -> tuple[str, int, str]:
    """Save an uploaded image to the image-set namespace.

    Returns (storage_key, size, sha256).
    """
    settings.ensure_storage_dirs()
    if not original_filename:
        raise StorageError("filename required")

    sha = hashlib.sha256()
    size = 0
    buf = bytearray()
    while True:
        chunk = source.read(1024 * 1024)
        if not chunk:
            break
        buf.extend(chunk)
        sha.update(chunk)
        size += len(chunk)
    if size == 0:
        raise StorageError("empty file")
    if size > settings.storage_max_upload_mb * 1024 * 1024:
        raise StorageError(f"file exceeds max size {settings.storage_max_upload_mb}MB")

    hex_sha = sha.hexdigest()
    key = _safe_image_key(set_id, hex_sha, original_filename)
    dest_path = settings.storage_root / "uploads" / key
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    with dest_path.open("wb") as out:
        out.write(bytes(buf))
    return key, size, hex_sha


def export_path(name: str) -> Path:
    settings.ensure_storage_dirs()
    return settings.storage_root / "exports" / name


def _safe_knowledge_key(doc_id: int, original_filename: str, version_no: int) -> str:
    ext = Path(original_filename).suffix.lower()
    if not ext:
        ext = ".bin"
    stamp = datetime.utcnow().strftime("%Y%m")
    return f"knowledge/{stamp}/{doc_id}/v{version_no}{ext}"


def save_knowledge_upload(
    doc_id: int,
    version_no: int,
    original_filename: str,
    source: BinaryIO,
    max_bytes: int | None = None,
) -> tuple[str, int, str]:
    """Stream a policy knowledge document to disk without buffering the
    whole file in memory.

    Returns (storage_key, size, sha256).
    """
    settings.ensure_storage_dirs()
    if not original_filename:
        raise StorageError("filename required")

    cap = (
        max_bytes
        if max_bytes is not None
        else settings.storage_max_upload_mb * 1024 * 1024
    )
    key = _safe_knowledge_key(doc_id, original_filename, version_no)
    dest_path = settings.storage_root / "uploads" / key
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    sha = hashlib.sha256()
    size = 0
    try:
        with dest_path.open("wb") as out:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > cap:
                    raise StorageError(f"file exceeds max size {cap // (1024 * 1024)}MB")
                out.write(chunk)
                sha.update(chunk)
    except StorageError:
        dest_path.unlink(missing_ok=True)
        raise

    if size == 0:
        dest_path.unlink(missing_ok=True)
        raise StorageError("empty file")

    return key, size, sha.hexdigest()
