"""MaterialPackage router: CRUD, submit for review."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.material import Material, MaterialStatus
from app.models.material_package import MaterialPackage, MaterialPackageItem, PackageStatus
from app.models.user import User
from app.schemas.common import Page
from app.schemas.material_package import (
    MaterialPackageCreate,
    MaterialPackageItemOut,
    MaterialPackageListItem,
    MaterialPackageOut,
    MaterialPackageSubmitRequest,
    MaterialPackageUpdate,
)
from app.services.workflow_engine import get_template_by_code, start_instance

router = APIRouter(prefix="/material-packages", tags=["material-packages"])


@router.get("", response_model=Page[MaterialPackageListItem])
async def list_packages(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    status_filter: PackageStatus | None = Query(default=None, alias="status"),
    material_type: str | None = None,
    q: str | None = None,
    mine: bool = False,
) -> Page[MaterialPackageListItem]:
    stmt = select(MaterialPackage)
    conditions = []
    if mine:
        conditions.append(MaterialPackage.creator_id == user.id)
    if status_filter:
        conditions.append(MaterialPackage.status == status_filter)
    if material_type:
        conditions.append(MaterialPackage.material_type == material_type)
    if q:
        conditions.append(MaterialPackage.name.ilike(f"%{q}%"))
    if conditions:
        from sqlalchemy import and_
        stmt = stmt.where(and_(*conditions))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = stmt.order_by(MaterialPackage.updated_at.desc()).offset((page - 1) * size).limit(size)
    result = await db.execute(stmt)
    packages = result.scalars().all()

    items = []
    for pkg in packages:
        count_stmt = select(func.count()).select_from(MaterialPackageItem).where(
            MaterialPackageItem.package_id == pkg.id
        )
        count = await db.scalar(count_stmt) or 0
        item = MaterialPackageListItem.model_validate(pkg)
        item.item_count = count
        items.append(item)

    return Page(items=items, total=total, page=page, size=size)


@router.post("", response_model=MaterialPackageOut, status_code=status.HTTP_201_CREATED)
async def create_package(
    body: MaterialPackageCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MaterialPackage:
    if body.material_type not in ("image", "video", "pdf", "text"):
        raise HTTPException(status_code=400, detail="invalid material_type")

    pkg = MaterialPackage(
        name=body.name,
        description=body.description,
        material_type=body.material_type,
        creator_id=user.id,
    )
    db.add(pkg)
    await db.flush()

    for idx, mid in enumerate(body.material_ids):
        material = await db.get(Material, mid)
        if not material:
            raise HTTPException(status_code=400, detail=f"material {mid} not found")
        if material.material_type.value != body.material_type:
            raise HTTPException(
                status_code=400,
                detail=f"material {mid} type mismatch: expected {body.material_type}",
            )
        item = MaterialPackageItem(
            package_id=pkg.id,
            material_id=mid,
            position=idx,
        )
        db.add(item)

    await db.commit()
    await db.refresh(pkg)

    stmt = (
        select(MaterialPackage)
        .where(MaterialPackage.id == pkg.id)
        .options(selectinload(MaterialPackage.items).selectinload(MaterialPackageItem.material))
    )
    result = await db.execute(stmt)
    pkg = result.scalar_one()
    return _package_to_out(pkg)


@router.get("/{package_id}", response_model=MaterialPackageOut)
async def get_package(
    package_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MaterialPackageOut:
    stmt = (
        select(MaterialPackage)
        .where(MaterialPackage.id == package_id)
        .options(
            selectinload(MaterialPackage.items).selectinload(MaterialPackageItem.material).selectinload(Material.versions)
        )
    )
    result = await db.execute(stmt)
    pkg = result.scalar_one_or_none()
    if not pkg:
        raise HTTPException(status_code=404, detail="package not found")
    return _package_to_out(pkg)


@router.put("/{package_id}", response_model=MaterialPackageOut)
async def update_package(
    package_id: int,
    body: MaterialPackageUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MaterialPackageOut:
    stmt = (
        select(MaterialPackage)
        .where(MaterialPackage.id == package_id)
        .options(selectinload(MaterialPackage.items))
    )
    result = await db.execute(stmt)
    pkg = result.scalar_one_or_none()
    if not pkg:
        raise HTTPException(status_code=404, detail="package not found")
    if pkg.status != PackageStatus.DRAFT:
        raise HTTPException(status_code=409, detail="only draft packages can be edited")
    if pkg.creator_id != user.id and user.role.value != "admin":
        raise HTTPException(status_code=403, detail="not your package")

    if body.name is not None:
        pkg.name = body.name
    if body.description is not None:
        pkg.description = body.description

    if body.material_ids is not None:
        existing_items = {item.material_id: item for item in pkg.items}
        new_ids = set(body.material_ids)

        for item in pkg.items:
            if item.material_id not in new_ids:
                await db.delete(item)

        current_max_pos = max((item.position for item in pkg.items), default=-1)
        for idx, mid in enumerate(body.material_ids):
            if mid not in existing_items:
                material = await db.get(Material, mid)
                if not material:
                    raise HTTPException(status_code=400, detail=f"material {mid} not found")
                if material.material_type.value != pkg.material_type:
                    raise HTTPException(
                        status_code=400,
                        detail=f"material {mid} type mismatch: expected {pkg.material_type}",
                    )
                new_item = MaterialPackageItem(
                    package_id=pkg.id,
                    material_id=mid,
                    position=current_max_pos + idx + 1,
                )
                db.add(new_item)

        for idx, mid in enumerate(body.material_ids):
            if mid in existing_items:
                existing_items[mid].position = idx

    await db.commit()

    stmt = (
        select(MaterialPackage)
        .where(MaterialPackage.id == package_id)
        .options(selectinload(MaterialPackage.items).selectinload(MaterialPackageItem.material))
    )
    result = await db.execute(stmt)
    pkg = result.scalar_one()
    return _package_to_out(pkg)


@router.delete("/{package_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_package(
    package_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    stmt = (
        select(MaterialPackage)
        .where(MaterialPackage.id == package_id)
        .options(selectinload(MaterialPackage.items))
    )
    result = await db.execute(stmt)
    pkg = result.scalar_one_or_none()
    if not pkg:
        raise HTTPException(status_code=404, detail="package not found")
    if pkg.status != PackageStatus.DRAFT:
        raise HTTPException(status_code=409, detail="only draft packages can be deleted")
    if pkg.creator_id != user.id and user.role.value != "admin":
        raise HTTPException(status_code=403, detail="not your package")

    await db.delete(pkg)
    await db.commit()


@router.post("/{package_id}/submit", response_model=MaterialPackageOut)
async def submit_package(
    package_id: int,
    body: MaterialPackageSubmitRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MaterialPackageOut:
    stmt = (
        select(MaterialPackage)
        .where(MaterialPackage.id == package_id)
        .options(
            selectinload(MaterialPackage.items).selectinload(MaterialPackageItem.material)
        )
    )
    result = await db.execute(stmt)
    pkg = result.scalar_one_or_none()
    if not pkg:
        raise HTTPException(status_code=404, detail="package not found")
    if pkg.status != PackageStatus.DRAFT:
        raise HTTPException(status_code=409, detail="package already submitted")
    if not pkg.items:
        raise HTTPException(status_code=400, detail="package has no materials")
    if pkg.creator_id != user.id and user.role.value != "admin":
        raise HTTPException(status_code=403, detail="not your package")

    template_code = body.workflow_template_code or "hybrid"
    template = await get_template_by_code(db, template_code)
    if not template:
        raise HTTPException(status_code=400, detail=f"unknown workflow template: {template_code}")

    for item in pkg.items:
        material = item.material
        if not material.current_version_id:
            raise HTTPException(
                status_code=400,
                detail=f"material '{material.title}' has no version to submit",
            )
        if material.status not in (MaterialStatus.DRAFT, MaterialStatus.REJECTED):
            raise HTTPException(
                status_code=409,
                detail=f"material '{material.title}' cannot be submitted (status: {material.status.value})",
            )
        from app.services.human_review_merge import merge_and_normalize_human_review
        strategy_hr = None  # 批量提交不解析 strategy；override 直接生效
        merged_hr = merge_and_normalize_human_review(strategy_hr, body.override_human_review)
        await start_instance(
            db, material, template, user,
            force_human_rules=body.force_human_rules,
            task_name=body.task_name,
            strategy_human_review=merged_hr,
        )

    await db.flush()

    from sqlalchemy import select as sa_select
    task_stmt = sa_select(MaterialPackageItem).where(
        MaterialPackageItem.package_id == package_id
    ).options(selectinload(MaterialPackageItem.review_task))
    task_result = await db.execute(task_stmt)
    updated_items = task_result.scalars().all()

    for item in updated_items:
        if item.review_task:
            item.review_task_id = item.review_task.id

    pkg.status = PackageStatus.IN_REVIEW
    await db.commit()

    stmt = (
        select(MaterialPackage)
        .where(MaterialPackage.id == package_id)
        .options(selectinload(MaterialPackage.items).selectinload(MaterialPackageItem.material))
    )
    result = await db.execute(stmt)
    pkg = result.scalar_one()
    return _package_to_out(pkg)


def _package_to_out(pkg: MaterialPackage) -> MaterialPackageOut:
    out = MaterialPackageOut.model_validate(pkg)
    out.items = []
    for item in pkg.items:
        item_out = MaterialPackageItemOut.model_validate(item)
        if hasattr(item, "material") and item.material:
            from app.schemas.material import MaterialOut, MaterialVersionOut
            mat_out = MaterialOut.model_validate(item.material)
            mat_out.versions = [
                MaterialVersionOut.model_validate(v) for v in (item.material.versions or [])
            ]
            item_out.material = mat_out
        out.items.append(item_out)
    return out
