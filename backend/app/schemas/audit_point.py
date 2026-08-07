"""AuditPoint schemas."""
from datetime import datetime
from typing import TYPE_CHECKING, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.audit_point import AuditPointRisk
from app.schemas.common import ORMBase

if TYPE_CHECKING:
    from app.models.audit_point import AuditPoint


def serialize_audit_point(point: "AuditPoint") -> dict:
    """Convert an AuditPoint ORM instance to a dict suitable for
    AuditPointOut.model_validate.

    「关联自定义图库词库」已从审核点上移至审核项；不再序列化 linked_libraries。
    """
    data = {
        "id": point.id,
        "public_id": point.public_id,
        "package_code": point.package_code,
        "item_id": point.item_id,
        "code": point.code,
        "label": point.label,
        "label_cn": point.label_cn,
        "description": point.description,
        "medium_threshold": point.medium_threshold,
        "high_threshold": point.high_threshold,
        "scope_text": point.scope_text,
        "risk_level": point.risk_level,
        "is_enabled": point.is_enabled,
        "is_builtin": point.is_builtin,
        "custom_wordset_id": point.custom_wordset_id,
        "sort_order": point.sort_order,
        "source_document_id": getattr(point, "source_document_id", None),
        "source_quote": getattr(point, "source_quote", None),
        "source_line_no": getattr(point, "source_line_no", None),
        "created_at": point.created_at,
        "updated_at": point.updated_at,
    }
    return data


class AuditPointOut(ORMBase):
    id: int
    package_code: str
    item_id: int
    code: str
    label: str
    label_cn: str
    description: Optional[str] = None
    medium_threshold: float
    high_threshold: float
    scope_text: Optional[str] = None
    risk_level: AuditPointRisk = AuditPointRisk.MEDIUM
    is_enabled: bool
    is_builtin: bool = False
    custom_wordset_id: Optional[int] = None
    sort_order: int = 0
    # 「关联自定义图库词库」已从审核点上移至审核项 (LinkedLibrary 现挂在 AuditItemOut)。
    # 旧 audit_point_libraries 表保留只读，不再由 API 写入。
    # 解析来源追溯 (2026-07-20)：仅由「自定义规则 Agent」上传文件解析时写入。
    source_document_id: Optional[int] = None
    source_quote: Optional[str] = None
    source_line_no: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class AuditPointCreate(BaseModel):
    """写入 schema — is_builtin 不暴露，服务端强制为 False。

    关联自定义库已上移至审核项；此 schema 不再接收 ``linked_library_ids``。
    """

    model_config = ConfigDict(extra="forbid")

    item_id: int
    label_cn: str = Field(min_length=1, max_length=64)
    description: Optional[str] = None
    medium_threshold: float = Field(default=60.0, ge=50.0, le=100.0)
    high_threshold: float = Field(default=90.0, ge=0.0, le=100.0)
    # 区间形态：每个阈值拆成 [下限, 上限]。与单值并存；任一组出现即覆盖。
    low_threshold_min: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    low_threshold_max: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    medium_threshold_min: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    medium_threshold_max: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    high_threshold_min: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    high_threshold_max: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    scope_text: Optional[str] = Field(default=None, max_length=255)
    risk_level: AuditPointRisk = AuditPointRisk.MEDIUM
    is_enabled: bool = False
    custom_wordset_id: Optional[int] = None
    sort_order: int = 0

    @model_validator(mode="after")
    def _check_order(self):
        # 单值：中 < 高
        if self.medium_threshold >= self.high_threshold:
            raise ValueError("中风险分必须 < 高风险分")
        # 区间：min < max
        if (
            self.low_threshold_min is not None
            and self.low_threshold_max is not None
            and self.low_threshold_min >= self.low_threshold_max
        ):
            raise ValueError("低风险分下限必须 < 低风险分上限")
        if (
            self.medium_threshold_min is not None
            and self.medium_threshold_max is not None
            and self.medium_threshold_min >= self.medium_threshold_max
        ):
            raise ValueError("中风险分下限必须 < 中风险分上限")
        if (
            self.high_threshold_min is not None
            and self.high_threshold_max is not None
            and self.high_threshold_min >= self.high_threshold_max
        ):
            raise ValueError("高风险分下限必须 < 高风险分上限")
        # 中区间上限 = 高区间下限 - 0.01 (业务规则 2026-07-28)
        # 中风险分上限由高风险分下限自动反推,差值固定 0.01
        if (
            self.medium_threshold_max is not None
            and self.high_threshold_min is not None
            and abs(self.medium_threshold_max + 0.01 - self.high_threshold_min) > 1e-6
        ):
            raise ValueError(
                f"中风险分上限 ({self.medium_threshold_max}) 必须等于 "
                f"高风险分下限 ({self.high_threshold_min}) - 0.01"
            )
        # 低区间上限 = 中区间下限 - 0.01 (业务规则 2026-07-29)
        if (
            self.low_threshold_max is not None
            and self.medium_threshold_min is not None
            and abs(self.low_threshold_max + 0.01 - self.medium_threshold_min) > 1e-6
        ):
            raise ValueError(
                f"低风险分上限 ({self.low_threshold_max}) 必须等于 "
                f"中风险分下限 ({self.medium_threshold_min}) - 0.01"
            )
        return self


class AuditPointUpdate(BaseModel):
    """写入 schema — 内置（is_builtin=True）仅允许修改：is_enabled
    / medium_threshold / high_threshold。其余字段在 service 层 422 拦截。

    关联自定义库已上移至审核项；不再接收 ``linked_library_ids``。
    """

    model_config = ConfigDict(extra="forbid")

    label_cn: Optional[str] = Field(default=None, min_length=1, max_length=64)
    description: Optional[str] = None
    medium_threshold: Optional[float] = Field(default=None, ge=50.0, le=100.0)
    high_threshold: Optional[float] = Field(default=None, ge=50.0, le=100.0)
    low_threshold_min: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    low_threshold_max: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    medium_threshold_min: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    medium_threshold_max: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    high_threshold_min: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    high_threshold_max: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    scope_text: Optional[str] = Field(default=None, max_length=255)
    risk_level: Optional[AuditPointRisk] = None
    is_enabled: Optional[bool] = None
    custom_wordset_id: Optional[int] = None
    sort_order: Optional[int] = None

    @model_validator(mode="after")
    def _check_order(self):
        # 单值：中 < 高
        if (
            self.medium_threshold is not None
            and self.high_threshold is not None
            and self.medium_threshold >= self.high_threshold
        ):
            raise ValueError("中风险分必须 < 高风险分")
        # 区间：min < max
        if (
            self.low_threshold_min is not None
            and self.low_threshold_max is not None
            and self.low_threshold_min >= self.low_threshold_max
        ):
            raise ValueError("低风险分下限必须 < 低风险分上限")
        if (
            self.medium_threshold_min is not None
            and self.medium_threshold_max is not None
            and self.medium_threshold_min >= self.medium_threshold_max
        ):
            raise ValueError("中风险分下限必须 < 中风险分上限")
        if (
            self.high_threshold_min is not None
            and self.high_threshold_max is not None
            and self.high_threshold_min >= self.high_threshold_max
        ):
            raise ValueError("高风险分下限必须 < 高风险分上限")
        # 中区间上限 = 高区间下限 - 0.01 (业务规则 2026-07-28)
        if (
            self.medium_threshold_max is not None
            and self.high_threshold_min is not None
            and abs(self.medium_threshold_max + 0.01 - self.high_threshold_min) > 1e-6
        ):
            raise ValueError(
                f"中风险分上限 ({self.medium_threshold_max}) 必须等于 "
                f"高风险分下限 ({self.high_threshold_min}) - 0.01"
            )
        # 低区间上限 = 中区间下限 - 0.01 (业务规则 2026-07-29)
        if (
            self.low_threshold_max is not None
            and self.medium_threshold_min is not None
            and abs(self.low_threshold_max + 0.01 - self.medium_threshold_min) > 1e-6
        ):
            raise ValueError(
                f"低风险分上限 ({self.low_threshold_max}) 必须等于 "
                f"中风险分下限 ({self.medium_threshold_min}) - 0.01"
            )
        return self


class AuditPointResetResult(BaseModel):
    items: list[AuditPointOut]


class AuditPointBatchCreate(BaseModel):
    item_id: int
    points: list[AuditPointCreate] = Field(min_length=1, max_length=100)


class AuditPointBatchItem(BaseModel):
    index: int
    label_cn: str
    status: Literal["ok", "error"]
    point: Optional[AuditPointOut] = None
    error: Optional[str] = None


class AuditPointBatchResult(BaseModel):
    succeeded: int
    failed: int
    items: list[AuditPointBatchItem]