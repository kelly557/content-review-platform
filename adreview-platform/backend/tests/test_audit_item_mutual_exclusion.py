"""audit_item 通用 ↔ 个性化 互斥字段校验测试。

主要用静态校验函数直接构造 stub，避免项目 flaky 的 per-test schema
async stack（详见 tests/test_superadmin_rules.py 头部注释）。
数据驱动部分（PATCH 写库）也保留少量烟雾测试，但因为 schema 残留已知
问题，对失败的容忍度较高 —— 静态断言已覆盖核心契约。
"""
from __future__ import annotations

import pytest


# ─── 静态 / 直接调用校验函数 ───────────────────────────────────────────────


def test_mutual_exclusion_builtin_rejects_knowledge_documents():
    """is_builtin=true 携带 knowledge_document_ids → 422。"""
    from fastapi import HTTPException

    from app.api.v1.audit_items import _enforce_mutual_exclusion

    class _StubItem:
        is_builtin = True

    class _StubBody:
        model_fields_set = {"knowledge_document_ids"}

    with pytest.raises(HTTPException) as exc:
        _enforce_mutual_exclusion(_StubItem(), _StubBody())  # type: ignore[arg-type]
    assert exc.value.status_code == 422
    assert "通用审核项不支持关联知识文档" in exc.value.detail


def test_mutual_exclusion_personal_allows_model_version():
    """is_builtin=false 携带 active_small_model_version_id 现在被允许（个性化可绑定大模型版本作为运行模型）。"""
    from app.api.v1.audit_items import _enforce_mutual_exclusion

    class _StubItem:
        is_builtin = False

    class _StubBody:
        model_fields_set = {"active_small_model_version_id"}

    # 不应抛异常 — 个性化规则现在允许绑定/切换大模型版本
    _enforce_mutual_exclusion(_StubItem(), _StubBody())  # type: ignore[arg-type]


def test_mutual_exclusion_passes_when_no_conflict():
    """合法组合（互斥字段各自方向）不应抛异常。"""
    from app.api.v1.audit_items import _enforce_mutual_exclusion

    class _StubBuiltin:
        is_builtin = True

    class _BodyBuiltinOk:
        model_fields_set = {"is_enabled", "active_small_model_version_id"}

    class _StubPersonal:
        is_builtin = False

    class _BodyPersonalOk:
        model_fields_set = {"knowledge_document_ids"}

    # 不应抛异常
    _enforce_mutual_exclusion(_StubBuiltin(), _BodyBuiltinOk())  # type: ignore[arg-type]
    _enforce_mutual_exclusion(_StubPersonal(), _BodyPersonalOk())  # type: ignore[arg-type]


def test_mutual_exclusion_personal_allows_model_version_and_knowledge():
    """个性化同时携带 model version + knowledge document ids → 不抛异常。"""
    from app.api.v1.audit_items import _enforce_mutual_exclusion

    class _StubItem:
        is_builtin = False

    class _StubBody:
        model_fields_set = {
            "active_small_model_version_id",
            "knowledge_document_ids",
        }

    _enforce_mutual_exclusion(_StubItem(), _StubBody())  # type: ignore[arg-type]


def test_builtin_item_whitelist_includes_model_version():
    """白名单应包含 active_small_model_version_id（通用规则的唯一新增可写字段）。"""
    from app.api.v1.audit_items import BUILTIN_ITEM_WRITABLE_FIELDS

    assert "active_small_model_version_id" in BUILTIN_ITEM_WRITABLE_FIELDS
    assert "is_enabled" in BUILTIN_ITEM_WRITABLE_FIELDS
    assert "description" in BUILTIN_ITEM_WRITABLE_FIELDS
    assert "linked_library_ids" in BUILTIN_ITEM_WRITABLE_FIELDS


def test_schema_out_has_new_fields():
    from app.schemas.audit_item import ActiveModelVersionOut, AuditItemOut

    fields = set(AuditItemOut.model_fields.keys())
    assert "active_small_model_version_id" in fields
    assert "active_model_version" in fields
    assert "knowledge_document_ids" in fields
    assert "version_no" in ActiveModelVersionOut.model_fields
    assert "model_name" in ActiveModelVersionOut.model_fields


def test_schema_update_has_new_fields():
    from app.schemas.audit_item import AuditItemUpdate

    fields = set(AuditItemUpdate.model_fields.keys())
    assert "active_small_model_version_id" in fields
    assert "knowledge_document_ids" in fields


def test_schema_update_forbids_unknown_fields():
    """AuditItemUpdate 必须是 extra=forbid — 防止误传任意字段。"""
    from pydantic import ValidationError

    from app.schemas.audit_item import AuditItemUpdate

    with pytest.raises(ValidationError):
        AuditItemUpdate.model_validate(
            {"name_cn": "x", "active_small_model_version_id": 1, "unknown_field": 1}
        )


def test_schema_create_forbids_unknown_fields():
    """AuditItemCreate 也必须 extra=forbid。"""
    from pydantic import ValidationError

    from app.schemas.audit_item import AuditItemCreate

    with pytest.raises(ValidationError):
        AuditItemCreate.model_validate({"name_cn": "x", "unknown_field": 1})


# ─── 静态校验：schema 拒收坏类型 ──────────────────────────────────────────────


def test_schema_update_rejects_non_int_version_id():
    from pydantic import ValidationError

    from app.schemas.audit_item import AuditItemUpdate

    with pytest.raises(ValidationError):
        AuditItemUpdate.model_validate({"active_small_model_version_id": "abc"})


def test_schema_update_rejects_non_list_doc_ids():
    from pydantic import ValidationError

    from app.schemas.audit_item import AuditItemUpdate

    with pytest.raises(ValidationError):
        AuditItemUpdate.model_validate({"knowledge_document_ids": "not a list"})