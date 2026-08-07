"""Model artifact storage — local filesystem for small-model files (ONNX/PT/etc.).

设计要点：
- 不与 materials 共用目录：模型权重是机器消费，长时间保留且不应被外部清理任务卷到
- 文件名带 UUID 防冲突
- 路径形如 models/{yyyy}/{mm}/{uuid}{ext}，相对 storage_root
- 流式算 sha256（O(1) 内存）
- 暴露给上层的接口只关心 (key, abs_path)，不耦合 settings
"""
from __future__ import annotations

import hashlib
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import BinaryIO

from app.core.config import settings


class ArtifactStorageError(Exception):
    pass


_MODEL_EXT_RE = re.compile(r"^[A-Za-z0-9_.\-+]{1,16}$")


def _ext_of(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if not ext or not _MODEL_EXT_RE.match(ext):
        return ""
    return ext


def _safe_filename(filename: str) -> str:
    name = Path(filename).name
    if not name or "/" in name or "\\" in name:
        raise ArtifactStorageError(f"非法文件名: {filename!r}")
    if len(name) > 255:
        raise ArtifactStorageError("文件名过长 (≤255)")
    return name


def build_storage_key(filename: str) -> str:
    """生成形如 models/2026/07/<uuid>{ext} 的 storage_key。"""
    ext = _ext_of(filename) or ""
    now = datetime.utcnow()
    return f"models/{now:%Y}/{now:%m}/{uuid.uuid4().hex}{ext}"


def _abs_path(storage_key: str) -> Path:
    if ".." in storage_key.split("/"):
        raise ArtifactStorageError("非法 storage_key（路径穿越）")
    p = (settings.storage_root / storage_key).resolve()
    base = settings.storage_root.resolve()
    if not str(p).startswith(str(base)):
        raise ArtifactStorageError("非法 storage_key")
    return p


def save_artifact(filename: str, source: BinaryIO, max_bytes: int | None = None) -> dict:
    """保存上传的小模型文件，返回 {storage_key, filename, mime_type, size, sha256}。

    - max_bytes 默认取 settings.storage_max_upload_mb * 1024 * 1024
    - 边写边算 sha256，不读入全文件
    """
    safe_name = _safe_filename(filename)
    key = build_storage_key(safe_name)
    abs_path = _abs_path(key)
    abs_path.parent.mkdir(parents=True, exist_ok=True)

    sha = hashlib.sha256()
    total = 0
    chunk = 1024 * 1024
    cap = (max_bytes or (settings.storage_max_upload_mb * 1024 * 1024))
    try:
        with open(abs_path, "wb") as f:
            while True:
                buf = source.read(chunk)
                if not buf:
                    break
                total += len(buf)
                if total > cap:
                    f.close()
                    try:
                        abs_path.unlink(missing_ok=True)
                    except OSError:
                        pass
                    raise ArtifactStorageError(
                        f"文件超过最大限制 {cap // (1024 * 1024)} MB"
                    )
                sha.update(buf)
                f.write(buf)
    except ArtifactStorageError:
        raise
    except Exception as exc:  # noqa: BLE001
        try:
            abs_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise ArtifactStorageError(f"保存失败: {exc}") from exc

    return {
        "storage_key": key,
        "filename": safe_name,
        "size": total,
        "sha256": sha.hexdigest(),
    }


def open_artifact(storage_key: str) -> tuple[Path, str]:
    """返回 (绝对路径, 文件名)。文件不存在抛 ArtifactStorageError。"""
    abs_path = _abs_path(storage_key)
    if not abs_path.exists() or not abs_path.is_file():
        raise ArtifactStorageError("文件不存在或已丢失")
    return abs_path, abs_path.name


def delete_artifact(storage_key: str) -> None:
    """删除本地文件；不存在时静默成功（幂等）。"""
    try:
        abs_path = _abs_path(storage_key)
    except ArtifactStorageError:
        return
    try:
        os.remove(abs_path)
    except FileNotFoundError:
        return
    except OSError as exc:
        raise ArtifactStorageError(f"删除失败: {exc}") from exc