"""Tag service — CRUD + 三级级联校验 + 树查询 + 模型反查 + 引用清单。"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Tuple

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.registered_model import RegisteredModel, RegisteredModelKind
from app.models.strategy import Strategy
from app.models.strategy_tag_ref import StrategyTagRef
from app.models.tag import (
    TAG_LEVEL_LEAF,
    TAG_LEVEL_MID,
    TAG_LEVEL_TOP,
    VALID_TAG_LEVELS,
    Tag,
    TagStatus,
)
from app.schemas.tag import (
    TagCreate,
    TagReferenceItem,
    TagReferenceList,
    TagReferenceModel,
    TagReferencesResponse,
    TagReferenceStrategy,
    TagTreeNode,
    TagUpdate,
)


class TagValidationError(ValueError):
    """Raised when a tag payload fails validation."""


class TagReferenceBlockError(Exception):
    """停用/删除被引用阻止时抛出,携带完整 references 供前端弹窗。"""

    def __init__(self, message: str, references: TagReferencesResponse):
        super().__init__(message)
        self.message = message
        self.references = references


# ───────────────────────── CRUD ─────────────────────────


async def list_tags(
    db: AsyncSession,
    *,
    page: int,
    size: int,
    domain: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[TagStatus] = None,
    jurisdictions: Optional[List[str]] = None,
    industries: Optional[List[str]] = None,
    channels: Optional[List[str]] = None,
    q: Optional[str] = None,
    level: Optional[int] = None,
    parent_id: Optional[str] = None,
    bound_model_id: Optional[int] = None,
) -> Tuple[List[Tag], int]:
    stmt = select(Tag)
    conds = [Tag.deleted_at.is_(None)]
    if domain:
        conds.append(Tag.domain == domain)
    if category:
        conds.append(Tag.category == category)
    if status:
        conds.append(Tag.status == status)
    if level is not None:
        conds.append(Tag.level == level)
    if parent_id is not None:
        conds.append(Tag.parent_id == parent_id)
    if bound_model_id is not None:
        conds.append(Tag.bound_model_id == bound_model_id)
    if q:
        conds.append(or_(Tag.name.ilike(f"%{q}%"), Tag.code.ilike(f"%{q}%")))
    if conds:
        stmt = stmt.where(and_(*conds))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = (
        stmt.order_by(Tag.level.asc(), Tag.updated_at.desc().nullslast(), Tag.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    rows = (await db.execute(stmt)).scalars().unique().all()

    if jurisdictions:
        rows = [
            t for t in rows if not t.jurisdictions or set(t.jurisdictions).intersection(jurisdictions)
        ]
    if industries:
        rows = [
            t for t in rows if not t.industries or set(t.industries).intersection(industries)
        ]
    if channels:
        rows = [
            t for t in rows if not t.channels or set(t.channels).intersection(channels)
        ]
    return list(rows), int(total)


async def get_tag(db: AsyncSession, tag_id: str, *, include_deleted: bool = False) -> Optional[Tag]:
    tag = await db.get(Tag, tag_id)
    if tag and not include_deleted and tag.deleted_at is not None:
        return None
    return tag


async def get_tag_by_code(db: AsyncSession, code: str) -> Optional[Tag]:
    return (await db.execute(select(Tag).where(Tag.code == code))).scalars().first()


async def create_tag(db: AsyncSession, body: TagCreate) -> Tag:
    existing = await get_tag_by_code(db, body.code)
    if existing:
        raise TagValidationError(f"code 已存在: {body.code}")

    await _validate_hierarchy_on_create(db, body)

    tag = Tag(
        code=body.code,
        name=body.name,
        name_en=body.name_en,
        description=body.description,
        domain=body.domain,
        category=body.category,
        jurisdictions=body.jurisdictions,
        industries=body.industries,
        channels=body.channels,
        knowledge_refs=body.knowledge_refs,
        evidence_refs=body.evidence_refs,
        status=body.status,
        level=body.level,
        parent_id=body.parent_id,
        bound_model_id=body.bound_model_id,
        bound_model_kind=body.bound_model_kind,
        version=1,
    )
    db.add(tag)
    await db.flush()
    await db.refresh(tag)
    return tag


async def update_tag(db: AsyncSession, tag: Tag, body: TagUpdate) -> Tag:
    data = body.model_dump(exclude_unset=True)

    # bound_model_id / bound_model_kind 联动校验：level=3 才能绑
    if "bound_model_id" in data or "bound_model_kind" in data:
        await _validate_bound_model_on_update(db, tag, data.get("bound_model_id"), data.get("bound_model_kind"))

    for k, v in data.items():
        setattr(tag, k, v)
    tag.version = (tag.version or 1) + 1
    await db.flush()
    await db.refresh(tag)
    return tag


async def delete_tag(db: AsyncSession, tag: Tag) -> None:
    """软删除标签：自身 + 全部后代一并软删除（保持树结构无孤儿）。

    删除前先查引用清单:任何引用(strategies / models)都禁止删除,
    抛 TagReferenceBlockError 让前端弹窗展示。
    """
    refs = await build_references_for_tag(db, tag.id)
    if not refs.can_delete:
        raise TagReferenceBlockError(
            "该标签被策略或模型引用,无法删除", refs
        )

    now = datetime.utcnow()
    # 先递归收集所有后代 id
    to_delete: list[Tag] = [tag]
    frontier: list[Tag] = [tag]
    while frontier:
        ids = [t.id for t in frontier]
        if not ids:
            break
        children = (
            await db.execute(
                select(Tag).where(
                    Tag.parent_id.in_(ids),
                    Tag.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        if not children:
            break
        to_delete.extend(children)
        frontier = children
    for t in to_delete:
        t.deleted_at = now
        t.status = TagStatus.DEPRECATED
        t.version = (t.version or 1) + 1


# ───────────────────── 层级校验 ─────────────────────


async def _validate_hierarchy_on_create(db: AsyncSession, body: TagCreate) -> None:
    """创建时的层级 + 父级 + 绑定模型校验。"""
    if body.level not in VALID_TAG_LEVELS:
        raise TagValidationError(f"level 必须是 1/2/3，收到 {body.level}")

    if body.level == TAG_LEVEL_TOP:
        if body.parent_id:
            raise TagValidationError("一级标签不能有父级")
    else:
        if not body.parent_id:
            raise TagValidationError(f"{_cn_level(body.level)}标签必须指定父级")
        parent = await get_tag(db, body.parent_id)
        if parent is None:
            raise TagValidationError(f"父级标签不存在: {body.parent_id}")
        if parent.level != body.level - 1:
            raise TagValidationError(
                f"{_cn_level(body.level)}标签的父级必须是{_cn_level(body.level - 1)}标签"
                f"（父级当前是{_cn_level(parent.level)}）"
            )

    if body.level == TAG_LEVEL_LEAF:
        if body.bound_model_id is None and body.bound_model_kind is None:
            pass
        else:
            if body.bound_model_id is None or body.bound_model_kind not in {"large", "small"}:
                raise TagValidationError(
                    "三级标签绑定模型时必须同时提供 bound_model_id 与 bound_model_kind（large/small）"
                )
            await _check_model_exists_and_kind(
                db, body.bound_model_id, body.bound_model_kind
            )
    else:
        if body.bound_model_id is not None or body.bound_model_kind is not None:
            raise TagValidationError(f"{_cn_level(body.level)}标签不允许绑定模型")


async def _validate_bound_model_on_update(
    db: AsyncSession, tag: Tag, model_id: Optional[int], model_kind: Optional[str]
) -> None:
    """更新时如改了 bound_model_*，按当前 level 校验。"""
    target_id = model_id if model_id is not None else tag.bound_model_id
    target_kind = model_kind if model_kind is not None else tag.bound_model_kind

    if target_id is None and target_kind is None:
        return

    if tag.level != TAG_LEVEL_LEAF:
        raise TagValidationError(f"{_cn_level(tag.level)}标签不允许绑定模型")
    if not target_id or target_kind not in {"large", "small"}:
        raise TagValidationError("三级标签绑定模型时必须同时提供 id 且 kind 必须为 large/small")
    await _check_model_exists_and_kind(db, target_id, target_kind)


async def _check_model_exists_and_kind(
    db: AsyncSession, model_id: int, kind: str
) -> None:
    model = await db.scalar(
        select(RegisteredModel).where(
            RegisteredModel.id == model_id,
            RegisteredModel.is_deleted.is_(False),
        )
    )
    if model is None:
        raise TagValidationError(f"绑定的模型不存在: {model_id}")
    if model.kind != kind:
        raise TagValidationError(
            f"模型 {model_id} 的类型是 {model.kind}，与标签声明的 {kind} 不一致"
        )


def _cn_level(level: int) -> str:
    return {TAG_LEVEL_TOP: "一级", TAG_LEVEL_MID: "二级", TAG_LEVEL_LEAF: "三级"}.get(level, str(level))


# ───────────────────── 树查询 ─────────────────────


async def build_tree(db: AsyncSession) -> List[TagTreeNode]:
    """返回完整三级树（含所有顶级节点）。

    实现：一次 select 所有未删除标签，按 parent_id 在内存里建树。
    标签量预期 < 10k，内存组装的复杂度可以接受；后续量大了再换 CTE。
    """
    rows = (
        await db.execute(
            select(Tag).where(Tag.deleted_at.is_(None)).order_by(Tag.level.asc(), Tag.created_at.asc())
        )
    ).scalars().all()

    # 预取 model 显示名
    model_ids = {t.bound_model_id for t in rows if t.bound_model_id}
    model_label: dict[int, str] = {}
    if model_ids:
        mrows = (
            await db.execute(
                select(RegisteredModel.id, RegisteredModel.name, RegisteredModel.kind).where(
                    RegisteredModel.id.in_(model_ids)
                )
            )
        ).all()
        for mid, mname, mkind in mrows:
            model_label[mid] = f"{mname} ({mkind})"

    nodes: dict[str, TagTreeNode] = {}
    for t in rows:
        nodes[t.id] = TagTreeNode(
            id=t.id,
            name=t.name,
            code=t.code,
            level=t.level,
            status=t.status,
            domain=t.domain,
            bound_model_id=t.bound_model_id,
            bound_model_kind=t.bound_model_kind,
            bound_model_label=model_label.get(t.bound_model_id) if t.bound_model_id else None,
            children=[],
        )

    roots: List[TagTreeNode] = []
    for t in rows:
        node = nodes[t.id]
        if t.parent_id and t.parent_id in nodes:
            nodes[t.parent_id].children.append(node)
        else:
            roots.append(node)
    return roots


# ───────────────────── 模型反查 ─────────────────────


async def list_references_by_model(db: AsyncSession, model_id: int) -> TagReferenceList:
    """反查：哪些三级标签绑定了 model_id；返回带完整路径的列表。"""
    rows = (
        await db.execute(
            select(Tag).where(
                Tag.deleted_at.is_(None),
                Tag.bound_model_id == model_id,
            )
        )
    ).scalars().all()

    # 构建 path（递归查 parent）
    # 对每条记录一路 parent 上去；同时为减少 N+1，先按 id 索引；按需再 select。
    parent_ids = {t.parent_id for t in rows if t.parent_id}
    ancestors: dict[str, Tag] = {}
    if parent_ids:
        a_rows = (
            await db.execute(
                select(Tag).where(Tag.id.in_(parent_ids), Tag.deleted_at.is_(None))
            )
        ).scalars().all()
        ancestors = {a.id: a for a in a_rows}

        # 二级祖先（如果祖先还有 parent）
        next_ids = {a.parent_id for a in ancestors.values() if a.parent_id}
        while next_ids:
            n_rows = (
                await db.execute(
                    select(Tag).where(Tag.id.in_(next_ids), Tag.deleted_at.is_(None))
                )
            ).scalars().all()
            new_ancestors = {a.id: a for a in n_rows if a.id not in ancestors}
            if not new_ancestors:
                break
            ancestors.update(new_ancestors)
            next_ids = {a.parent_id for a in new_ancestors.values() if a.parent_id}

    items: List[TagReferenceItem] = []
    for t in rows:
        path_parts = [t.name]
        cur = ancestors.get(t.parent_id) if t.parent_id else None
        while cur is not None:
            path_parts.insert(0, cur.name)
            cur = ancestors.get(cur.parent_id) if cur.parent_id else None
        items.append(
            TagReferenceItem(
                id=t.id,
                name=t.name,
                path=" / ".join(path_parts),
                level=t.level,
            )
        )

    return TagReferenceList(model_id=model_id, total=len(items), items=items)


# ───────────────────── 标签被引用清单(启用/删除前检查) ─────────────────────


async def _build_tag_path(db: AsyncSession, tag: Tag) -> str:
    """构造该 tag 到根的完整路径字符串:涉政 / 一号领导 / 漫画"""
    parts = [tag.name]
    cur_parent_id = tag.parent_id
    seen: set[str] = {tag.id}
    while cur_parent_id and cur_parent_id not in seen:
        seen.add(cur_parent_id)
        parent = await db.scalar(
            select(Tag).where(Tag.id == cur_parent_id, Tag.deleted_at.is_(None))
        )
        if parent is None:
            break
        parts.insert(0, parent.name)
        cur_parent_id = parent.parent_id
    return " / ".join(parts)


async def build_references_for_tag(
    db: AsyncSession, tag_id: str
) -> TagReferencesResponse:
    """聚合查询:哪些审核策略 / 模型在引用本 tag。

    用于「停用 / 删除」前的二次确认;返回的 can_* 字段已
    按当前业务规则计算好:
      can_deactivate = 没有 active 策略引用
      can_delete     = 任何引用都没有
    """
    tag = await db.scalar(
        select(Tag).where(Tag.id == tag_id, Tag.deleted_at.is_(None))
    )
    if tag is None:
        raise TagValidationError(f"标签不存在: {tag_id}")

    # 1) 模型引用:通过 bound_model_id 反查
    models: list[TagReferenceModel] = []
    if tag.bound_model_id:
        m = await db.scalar(
            select(RegisteredModel).where(
                RegisteredModel.id == tag.bound_model_id,
                RegisteredModel.is_deleted.is_(False),
            )
        )
        if m is not None:
            models.append(
                TagReferenceModel(
                    model_id=m.id,
                    model_name=m.name,
                    model_version=m.version or "",
                )
            )

    # 2) 策略引用：查 strategy_tag_refs 关联表，再逐个取 Strategy
    strategies: list[TagReferenceStrategy] = []
    ref_rows = (
        await db.execute(
            select(StrategyTagRef.strategy_id).where(StrategyTagRef.tag_id == tag_id)
        )
    ).scalars().all()
    for sid in ref_rows:
        strat = await db.get(Strategy, sid)
        if strat is None:
            continue
        services: list[str] = []
        if isinstance(strat.definition, dict):
            svcs = strat.definition.get("services")
            if isinstance(svcs, list):
                services = [str(s.get("code") if isinstance(s, dict) else s) for s in svcs if s]
        strategies.append(
            TagReferenceStrategy(
                strategy_id=strat.public_id,
                strategy_name=strat.name,
                status="active" if strat.is_active else "deprecated",
                services=services,
            )
        )

    # 3) 路径
    path = await _build_tag_path(db, tag)

    total = len(strategies) + len(models)
    has_active_strategy = any(s.status == "active" for s in strategies)

    return TagReferencesResponse(
        tag_id=tag.id,
        tag_name=tag.name,
        tag_level=tag.level,
        tag_path=path,
        strategies=strategies,
        models=models,
        can_deactivate=not has_active_strategy,
        can_delete=total == 0,
        total_references=total,
    )


async def deprecate_tag(db: AsyncSession, tag: Tag) -> Tag:
    """停用标签:被 active 策略引用时阻止;否则翻 status=deprecated。"""
    refs = await build_references_for_tag(db, tag.id)
    if not refs.can_deactivate:
        raise TagReferenceBlockError(
            "该标签被启用的审核策略引用,无法停用", refs
        )
    tag.status = TagStatus.DEPRECATED
    tag.version = (tag.version or 1) + 1
    await db.commit()
    await db.refresh(tag)
    return tag