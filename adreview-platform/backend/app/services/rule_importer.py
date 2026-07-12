"""Generic rule importer — table parser + Service/AuditItem/AuditPoint upsert.

Public surface:
    parse_table(text)             # pure parser; raises ParseError
    import_rules(db, request, *, dry_run=False)  # full upsert pipeline

Input table format (only supported shape):

    审核项  ｜  审核点    ｜  检测内容
    涉政    ｜  不出现国家领导人  ｜  现任国家领导人姓名
                ｜  不出现敏感事件  ｜  涉及敏感历史事件
    涉恐    ｜  不出现恐怖组织  ｜  涉恐组织名称及别称

- First non-empty / non-comment row is treated as the header. Header
  detection is fuzzy: the row is recognised as a header if it contains
  any of 「审核项」、「审核点」、「检测内容」. Otherwise we still try.
- A blank cell in column 1 means "same as previous non-empty row".
- Column 2 is required per row.
- Column 3 is optional → point.description.

Column separators (tried in order; first hit dictates the rest of the table):
    1. full-width pipe ｜
    2. half-width pipe |
    3. tab \t
    4. two-or-more spaces
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field


# ─────────────────────────── Parser ───────────────────────────


_HEADER_TOKENS = ("审核项", "审核点", "检测内容")


@dataclass(frozen=True)
class ParsedPoint:
    label_cn: str
    description: str | None = None


@dataclass
class ParsedItem:
    name_cn: str
    points: list[ParsedPoint] = field(default_factory=list)


@dataclass
class ParsedTable:
    items: list[ParsedItem] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not any(item.points for item in self.items)


class ParseError(Exception):
    def __init__(self, message: str, line: int = 0) -> None:
        super().__init__(message)
        self.message = message
        self.line = line


def _sep_full_pipe(s: str) -> bool:
    return "｜" in s


def _sep_half_pipe(s: str) -> bool:
    return "|" in s


def _sep_tab(s: str) -> bool:
    return "\t" in s


def _sep_two_spaces(s: str) -> bool:
    return re.search(r"  +", s) is not None


def _split_row(line: str, mode: str) -> list[str]:
    sep_char: str | None = None
    if mode == "full_pipe":
        sep_char = "｜"
        cells = line.split(sep_char)
    elif mode == "half_pipe":
        sep_char = "|"
        cells = line.split(sep_char)
    elif mode == "tab":
        cells = line.split("\t")
    elif mode == "two_spaces":
        cells = re.split(r"  +", line)
    else:
        return [line.strip()]
    # Markdown table rows start and end with the pipe (`| a | b |`). Only
    # treat cells as a leading empty wrapper when the line BEGINS (raw, no
    # lstrip) with the separator — otherwise this breaks the "carry-down"
    # idiom where the first column is padded with whitespace and the
    # separator comes after (`\u3000\u3000｜ next row ｜`).
    if sep_char is not None:
        if line.startswith(sep_char) and cells and cells[0] == "":
            cells = cells[1:]
        if line.endswith(sep_char) and cells and cells[-1] == "":
            cells = cells[:-1]
    return [c.strip() for c in cells]


def _detect_separator(line: str) -> str | None:
    if _sep_full_pipe(line):
        return "full_pipe"
    if _sep_half_pipe(line):
        return "half_pipe"
    if _sep_tab(line):
        return "tab"
    if _sep_two_spaces(line):
        return "two_spaces"
    return None


def _looks_like_header(cells: list[str]) -> bool:
    if not cells:
        return False
    joined = " ".join(cells)
    return any(tok in joined for tok in _HEADER_TOKENS)


_MD_SEP_CHARS = re.compile(r"^[\s|\-:]+$")


def _is_markdown_separator(line: str, sep: str) -> bool:
    """A markdown table separator row like `| ---- | ---- | ---- |` or
    `|:----:|:---:|---:|`. Only meaningful for pipe-based separators."""
    if sep not in ("full_pipe", "half_pipe"):
        return False
    return _MD_SEP_CHARS.match(line) is not None


def _code_slug(*parts: str) -> str:
    """Deterministic 16-hex slug from concatenated parts.

    Used only for stable identity of items / points derived from their
    name_cn. The DB enforces the unique constraint as the safety net
    against theoretical hash collisions.
    """
    payload = "\x1f".join(parts).encode("utf-8")
    return hashlib.sha1(payload).hexdigest()[:16]


def parse_table(text: str) -> ParsedTable:
    """Parse the table text. Raises ParseError on structural problems."""
    if not text or not text.strip():
        raise ParseError("表格内容为空", 0)

    raw_lines = text.splitlines()
    seed_idx = 0
    while seed_idx < len(raw_lines):
        line = raw_lines[seed_idx]
        if line.strip() and not line.lstrip().startswith("#"):
            break
        seed_idx += 1
    if seed_idx >= len(raw_lines):
        raise ParseError("表格内容为空", 0)
    sep = _detect_separator(raw_lines[seed_idx])
    if sep is None:
        raise ParseError(
            "未识别到列分隔符（｜ / | / TAB / 两个及以上空格）",
            seed_idx + 1,
        )

    # Build cleaned rows: drop blanks, `#` comments, and markdown table
    # separator rows (`| --- | --- |`). Preserve leading whitespace —
    # carry-down rows are written as `\u3000\u3000｜ next row`, and we
    # need that distinction to survive into `_split_row`.
    cleaned: list[tuple[int, str]] = []
    for idx, line in enumerate(raw_lines, start=1):
        if not line.strip():
            continue
        if line.lstrip().startswith("#"):
            continue
        if _is_markdown_separator(line.strip(), sep):
            continue
        cleaned.append((idx, line))

    if not cleaned:
        raise ParseError("表格内容为空", 0)

    header_idx: int | None = None
    for i, (_, line) in enumerate(cleaned):
        cells = _split_row(line, sep)
        if _looks_like_header(cells):
            header_idx = i
            break
    if header_idx is None:
        header_idx = -1

    table = ParsedTable()
    item_by_name: dict[str, ParsedItem] = {}
    seen_point_keys: set[tuple[str, str]] = set()
    sticky_item_name: str | None = None

    for i, (line_no, line) in enumerate(cleaned):
        if i == header_idx:
            continue
        cells = _split_row(line, sep)
        while len(cells) < 3:
            cells.append("")
        item_name_raw = cells[0].strip()
        point_name_raw = cells[1].strip()
        desc_raw = cells[2].strip()

        if not point_name_raw:
            raise ParseError(f"第 {line_no} 行 审核点为空", line_no)

        # Carry-down: when the first column is empty (whether the separator
        # wrapped the table or the user wrote `\u3000\u3000｜`), inherit
        # the last non-empty item name we saw.
        if item_name_raw:
            current_item_name = item_name_raw
            sticky_item_name = current_item_name
        else:
            if sticky_item_name is None:
                raise ParseError(
                    f"第 {line_no} 行 审核项为空（首行不能为空）", line_no
                )
            current_item_name = sticky_item_name

        item = item_by_name.get(current_item_name)
        if item is None:
            item = ParsedItem(name_cn=current_item_name)
            table.items.append(item)
            item_by_name[current_item_name] = item

        key = (current_item_name, point_name_raw)
        if key in seen_point_keys:
            raise ParseError(
                f"第 {line_no} 行 重复（审核项={current_item_name}, "
                f"审核点={point_name_raw} 已在前文出现）",
                line_no,
            )
        seen_point_keys.add(key)

        item.points.append(
            ParsedPoint(
                label_cn=point_name_raw,
                description=desc_raw or None,
            )
        )

    if not table.items or table.is_empty:
        raise ParseError("未能解析到任何「审核点」", 0)

    return table


# ─────────────────────────── DB upsert layer ───────────────────────────
#
# `import_rules(db, request, *, dry_run=False)` — top-level entry.
#
# Failure modes:
#   * ParseError       → surfaces as 422 with line number via HTTPException.
#   * IntegrityError   → rolled back; raised as 409.
#   * Builtin item-row point write → that single point is skipped +
#     recorded as a warning; the rest of the batch proceeds.
#
# `on_conflict`:
#   * "update" → existing items/points get their mutable fields updated.
#   * "skip"   → existing rows are left untouched (silently counted).

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint, AuditPointRisk
from app.models.service import Service
from app.schemas.rule_import import (
    RuleImportChange,
    RuleImportRequest,
    RuleImportResult,
    RuleImportSummary,
)


def _item_code(name_cn: str) -> str:
    return f"im_{_code_slug(name_cn)}"


def _point_code(item_name_cn: str, label_cn: str) -> str:
    return f"ip_{_code_slug(item_name_cn, label_cn)}"


# Media-type → rule-package code. The frontend only exposes "text" and
# "image" today; extend here to add audio / document / video.
MEDIA_TO_SERVICE_CODE: dict[str, str] = {
    "text": "text_audit_pro",
    "image": "image_audit_pro",
}


async def _ensure_package(db: AsyncSession, code: str) -> Service:
    svc = (
        await db.execute(select(Service).where(Service.code == code))
    ).scalar_one_or_none()
    if not svc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"审核包（service.code）不存在：{code}",
        )
    return svc


async def _upsert_item(
    db: AsyncSession,
    package_code: str,
    name_cn: str,
    code: str,
    is_enabled: bool,
    on_conflict: str,
    kind: str,
    confirm_downgrade: bool,
) -> tuple[AuditItem, str, Optional[str]]:
    """Returns (item, action, warning). action ∈ {"create","update","skip"}.

    `kind` controls the target is_builtin (true for "builtin", false for
    "personal"). When an existing row's class conflicts with `kind`:
      * personal → builtin (upgrade) is silent
      * builtin  → personal (downgrade) requires `confirm_downgrade=True`,
        otherwise raises 422. When confirmed, the response carries a warning.
    """
    item = (
        await db.execute(
            select(AuditItem).where(
                AuditItem.package_code == package_code,
                AuditItem.code == code,
            )
        )
    ).scalar_one_or_none()

    want_builtin = kind == "builtin"

    if item is None:
        item = AuditItem(
            package_code=package_code,
            code=code,
            name_cn=name_cn,
            aliases=[],
            description=None,
            sort_order=0,
            is_enabled=is_enabled,
            is_builtin=want_builtin,
        )
        db.add(item)
        try:
            await db.flush()
        except IntegrityError as exc:  # pragma: no cover
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"审核项 code 冲突：{code}",
            ) from exc
        return item, "create", None

    if on_conflict == "skip":
        return item, "skip", None

    warning: Optional[str] = None
    if item.is_builtin and not want_builtin:
        if not confirm_downgrade:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "审核项「"
                    + item.name_cn
                    + f"」(code={item.code}) 已存在且为「通用规则」，"
                    "请在请求体里加 confirm_downgrade=true 才能降级到「个性化规则」，"
                    "或者改用 kind=builtin 让其保持通用。"
                ),
            )
        item.is_builtin = False
        warning = (
            f"审核项「{item.name_cn}」(code={item.code}) "
            f"已从「通用规则」降级为「个性化规则」"
        )
    elif (not item.is_builtin) and want_builtin:
        item.is_builtin = True

    if item.is_builtin:
        item.is_enabled = is_enabled
    else:
        item.name_cn = name_cn
        item.is_enabled = is_enabled
    return item, "update", warning


async def _upsert_point(
    db: AsyncSession,
    package_code: str,
    item: AuditItem,
    label_cn: str,
    code: str,
    description: Optional[str],
    is_enabled: bool,
    medium_threshold: float,
    high_threshold: float,
    risk_level: AuditPointRisk,
    on_conflict: str,
    kind: str,
) -> tuple[Optional[AuditPoint], str, Optional[str]]:
    """Returns (point_or_none, action, warning_message).
    action ∈ {"create", "update", "skip"}.

    When the parent item is already `is_builtin=true` AND the caller asked
    for `kind="builtin"`, new points are allowed (we inherit the parent's
    builtin flag). Any other combination under an existing builtin item
    still refuses — matching the main /audit_points/batch guard.
    """
    point = (
        await db.execute(
            select(AuditPoint)
            .where(
                AuditPoint.package_code == package_code,
                AuditPoint.code == code,
            )
            .execution_options(populate_existing=True)
            .options(
                noload(AuditPoint.linked_libraries),
                noload(AuditPoint.linked_library_links),
            )
        )
    ).scalar_one_or_none()

    if point is None:
        if item.is_builtin and kind != "builtin":
            return None, "skip", (
                f"通用审核项「{item.name_cn}」(code={item.code}) 拒绝新增审核点"
            )
        point = AuditPoint(
            package_code=package_code,
            item_id=item.id,
            code=code,
            label=code,
            label_cn=label_cn,
            description=description,
            medium_threshold=medium_threshold,
            high_threshold=high_threshold,
            scope_text="",
            risk_level=risk_level,
            is_enabled=is_enabled,
            is_builtin=item.is_builtin,
            sort_order=0,
        )
        db.add(point)
        try:
            await db.flush()
        except IntegrityError as exc:  # pragma: no cover
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"审核点 code 冲突：{code}",
            ) from exc
        return point, "create", None

    if on_conflict == "skip":
        return point, "skip", None
    if point.is_builtin:
        point.is_enabled = is_enabled
        point.medium_threshold = medium_threshold
        point.high_threshold = high_threshold
    else:
        point.label_cn = label_cn
        point.description = description
        point.medium_threshold = medium_threshold
        point.high_threshold = high_threshold
        point.risk_level = risk_level
        point.is_enabled = is_enabled
    return point, "update", None


async def import_rules(
    db: AsyncSession,
    request: RuleImportRequest,
    *,
    dry_run: bool = False,
) -> RuleImportResult:
    """Parse, validate, upsert. `dry_run=True` rolls back at the end so no
    rows actually persist; the returned summary is the same shape."""
    try:
        parsed = parse_table(request.table_text)
    except Exception as exc:
        line = getattr(exc, "line", 0)
        msg = getattr(exc, "message", str(exc))
        prefix = f"第 {line} 行 " if line else ""
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"解析失败：{prefix}{msg}",
        ) from exc

    package_code = MEDIA_TO_SERVICE_CODE.get(request.media_type)
    if package_code is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"暂不支持的 media_type：{request.media_type}",
        )
    await _ensure_package(db, package_code)

    med = (
        request.default_medium_threshold
        if request.default_medium_threshold is not None
        else 60.0
    )
    high = (
        request.default_high_threshold
        if request.default_high_threshold is not None
        else 90.0
    )
    if med >= high:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="中风险分必须 < 高风险分",
        )
    risk = request.default_risk_level or AuditPointRisk.MEDIUM

    changes: list[RuleImportChange] = []
    warnings: list[str] = []
    summary = RuleImportSummary()

    try:
        for pitem in parsed.items:
            item_code = _item_code(pitem.name_cn)
            item, item_action, item_warn = await _upsert_item(
                db,
                package_code=package_code,
                name_cn=pitem.name_cn,
                code=item_code,
                is_enabled=request.is_enabled,
                on_conflict=request.on_conflict,
                kind=request.kind,
                confirm_downgrade=request.confirm_downgrade,
            )
            if item_warn:
                warnings.append(item_warn)
            if item_action == "create":
                summary.items_created += 1
            elif item_action == "update":
                summary.items_updated += 1
            else:
                summary.items_skipped += 1
            changes.append(
                RuleImportChange(
                    entity="item",
                    code=item.code,
                    label_cn=item.name_cn,
                    action=item_action,  # type: ignore[arg-type]
                    id=item.id,
                )
            )

            for ppoint in pitem.points:
                code = _point_code(pitem.name_cn, ppoint.label_cn)
                point, action, warn = await _upsert_point(
                    db,
                    package_code=package_code,
                    item=item,
                    label_cn=ppoint.label_cn,
                    code=code,
                    description=ppoint.description,
                    is_enabled=request.is_enabled,
                    medium_threshold=med,
                    high_threshold=high,
                    risk_level=risk,
                    on_conflict=request.on_conflict,
                    kind=request.kind,
                )
                if warn:
                    warnings.append(warn)
                if action == "create":
                    summary.points_created += 1
                elif action == "update":
                    summary.points_updated += 1
                else:
                    summary.points_skipped += 1
                changes.append(
                    RuleImportChange(
                        entity="point",
                        code=code,
                        item_code=item.code,
                        label_cn=ppoint.label_cn,
                        description=ppoint.description,
                        action=action,  # type: ignore[arg-type]
                        id=point.id if point else None,
                    )
                )

        if dry_run:
            await db.rollback()
        else:
            await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except IntegrityError as exc:  # pragma: no cover
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"数据库冲突：{exc.orig}",
        ) from exc
    except Exception as exc:  # pragma: no cover
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"导入失败：{exc!r}",
        ) from exc

    return RuleImportResult(
        package_code=package_code,
        summary=summary,
        changes=changes,
        warnings=warnings,
        errors=[],
    )
