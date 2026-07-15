"""Strategy schemas."""
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, model_validator

from app.models.strategy import StrategyScope
from app.schemas.common import ORMBase

VALID_RISK_LEVELS = ("低风险", "中风险", "高风险", "无风险", "敏感")
VALID_SENSITIVE_LEVELS = ("S0", "S1", "S2", "S3")


class VoiceRuleMode(str, Enum):
    """语音审核复用规则模式：复用文本 / 独立设置。

    存入 strategy.definition.voice_rule_mode。
    """

    REUSE_TEXT = "reuse_text"
    INDEPENDENT = "independent"


class DocTextMode(str, Enum):
    """文档审核「文本审核」组复用模式：复用文本 / 独立。"""

    REUSE_TEXT = "reuse_text"
    INDEPENDENT = "independent"


class DocImageMode(str, Enum):
    """文档审核「图像审核」组复用模式：复用图像 / 独立。"""

    REUSE_IMAGE = "reuse_image"
    INDEPENDENT = "independent"


class VideoFrameMode(str, Enum):
    """视频审核「画面审核」组复用模式：复用图像 / 独立。"""

    REUSE_IMAGE = "reuse_image"
    INDEPENDENT = "independent"


class VideoAudioMode(str, Enum):
    """视频审核「语音审核」组复用模式：复用短音频 / 独立。"""

    REUSE_AUDIO = "reuse_audio"
    INDEPENDENT = "independent"


class DocComposeModes(BaseModel):
    """文档审核的组合复用模式（文本 + 图像）。

    存入 strategy.definition.doc_text_mode / doc_image_mode。
    """

    text_mode: DocTextMode = DocTextMode.REUSE_TEXT
    image_mode: DocImageMode = DocImageMode.REUSE_IMAGE

    def normalized(self) -> "DocComposeModes":
        return DocComposeModes(
            text_mode=DocTextMode(self.text_mode),
            image_mode=DocImageMode(self.image_mode),
        )


class VideoComposeModes(BaseModel):
    """视频审核的组合复用模式（画面 + 语音）。

    存入 strategy.definition.video_frame_mode / video_audio_mode。
    """

    frame_mode: VideoFrameMode = VideoFrameMode.REUSE_IMAGE
    audio_mode: VideoAudioMode = VideoAudioMode.REUSE_AUDIO

    def normalized(self) -> "VideoComposeModes":
        return VideoComposeModes(
            frame_mode=VideoFrameMode(self.frame_mode),
            audio_mode=VideoAudioMode(self.audio_mode),
        )


class VideoFrameInterval(BaseModel):
    """视频抽帧频率（秒/帧）。范围 1..1000 整数。"""

    interval_sec: int = Field(default=5, ge=1, le=1000)

    def normalized(self) -> "VideoFrameInterval":
        v = int(self.interval_sec)
        if v < 1:
            v = 1
        elif v > 1000:
            v = 1000
        return VideoFrameInterval(interval_sec=v)


class AudioFeatures(BaseModel):
    """语音专有能力：声纹检测 / 音频质量。

    存入 strategy.definition.audio_features。
    与复用规则模式正交——无论 reuse_text / independent 都生效。
    """

    voiceprint: Dict[str, bool] = Field(default_factory=lambda: {"moaning": True})
    quality: Dict[str, bool] = Field(default_factory=lambda: {"no_speech": True})

    def normalized(self) -> "AudioFeatures":
        return AudioFeatures(
            voiceprint={
                "moaning": bool(self.voiceprint.get("moaning", True)),
            },
            quality={
                "no_speech": bool(self.quality.get("no_speech", True)),
            },
        )


class HumanReviewSettings(BaseModel):
    """策略级别的人工审核配置，存入 strategy.definition.human_review JSONB。

    升级人审的判定逻辑（与 backend/app/tasks/machine_review.py:should_escalate_to_human
    严格对齐）：

    - risk_levels：机审 risk_level 命中任一档即升级
    - sensitive_levels：仅当 risk_level == "敏感" 时参与；S1 永远走脱敏放行不升级；
      S2/S3 升级需 service 同时开启「召回模式」
    - sample_ratio：抽审比例（0~100，百分比），仅在符合升级条件时按比例抽样。
      None / 缺省 = 100%（即全部升级，向后兼容）。
    - auto_action_overrides：用户对每个 (risk, sensitive) cell 动作的覆盖。
    """

    is_enabled: bool = False
    risk_levels: List[str] = Field(default_factory=list)
    sensitive_levels: List[str] = Field(default_factory=list)
    review_rule_id: Optional[int] = None
    sample_ratio: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    auto_action_overrides: Dict[str, str] = Field(default_factory=dict)

    def normalized(self) -> "HumanReviewSettings":
        """清理后返回：仅保留合法 risk_levels / sensitive_levels，无意义字段置空。"""
        levels = [l for l in self.risk_levels if l in VALID_RISK_LEVELS]
        sensitives = [s for s in self.sensitive_levels if s in VALID_SENSITIVE_LEVELS]
        if not self.is_enabled:
            return HumanReviewSettings(
                is_enabled=False,
                risk_levels=[],
                sensitive_levels=[],
                review_rule_id=None,
                sample_ratio=None,
                auto_action_overrides={},
            )
        sr = self.sample_ratio if self.sample_ratio is not None else 100.0
        return HumanReviewSettings(
            is_enabled=True,
            risk_levels=levels,
            sensitive_levels=sensitives,
            review_rule_id=self.review_rule_id,
            sample_ratio=sr,
            auto_action_overrides=dict(self.auto_action_overrides),
        )

    def has_any_value(self) -> bool:
        """判断 override 是否有任何字段被显式设置（区分\"空 override\"和\"显式 override\"）。

        使用 ``model_fields_set`` 区分「未传」和「传了默认值」——例如：
        - ``HumanReviewSettings(is_enabled=False)`` → set, has_value=True
        - ``HumanReviewSettings()`` → set 为空, has_value=False
        """
        return len(self.model_fields_set) > 0


class StrategyItemRef(BaseModel):
    media_type: str = Field(min_length=1, max_length=16)
    item_id: int
    is_enabled: bool = True


class StrategyPointRef(BaseModel):
    media_type: str = Field(min_length=1, max_length=16)
    item_id: int
    point_id: int
    is_enabled: bool = True
    # 策略级 override；提交时透传到 strategies.definition.enabled_point_overrides，不写 audit_point
    medium_threshold: Optional[float] = Field(default=None, ge=50.0, le=100.0)
    high_threshold: Optional[float] = Field(default=None, ge=50.0, le=100.0)
    # 区间形态：每个阈值拆成 [下限, 上限]。与单值字段并存；任一组出现即覆盖。
    medium_threshold_min: Optional[float] = Field(default=None, ge=50.0, le=100.0)
    medium_threshold_max: Optional[float] = Field(default=None, ge=50.0, le=100.0)
    high_threshold_min: Optional[float] = Field(default=None, ge=50.0, le=100.0)
    high_threshold_max: Optional[float] = Field(default=None, ge=50.0, le=100.0)

    @model_validator(mode="after")
    def _validate_range(self) -> "StrategyPointRef":
        pairs = [
            ("medium_threshold_min", "medium_threshold_max"),
            ("high_threshold_min", "high_threshold_max"),
        ]
        for lo, hi in pairs:
            lo_v = getattr(self, lo)
            hi_v = getattr(self, hi)
            if lo_v is not None and hi_v is not None and lo_v >= hi_v:
                raise ValueError(f"{lo} ({lo_v}) 必须 < {hi} ({hi_v})")
        # 中区间上限 ≤ 高区间下限（允许边界相等）
        if (
            self.medium_threshold_max is not None
            and self.high_threshold_min is not None
            and self.medium_threshold_max > self.high_threshold_min
        ):
            raise ValueError(
                f"medium_threshold_max ({self.medium_threshold_max}) 必须 ≤ "
                f"high_threshold_min ({self.high_threshold_min})"
            )
        return self


class LlmReviewConfig(BaseModel):
    """策略级「大模型审核能力」总开关 + 选定的已激活大模型。

    单一开关（不按媒体类型拆分），单选资源库已加入的大模型。
    存入 ``strategy.definition.llm_review``；开启后所有纳入此策略的
    审核项均会调用该模型补充机审结果。

    注意：当策略所配置的规则覆盖了图片 / 音频 / 视频 / 文档等非文本媒体类型时，
    UI 会提示用户选择具备相应模态能力的「多模态」大模型，避免出现
    「文本模型被叫去做图片机审」的不匹配。
    """

    is_enabled: bool = False
    # 资源库中已激活 (`status=active`) 的大模型 ID。单选；None 表示启用但尚未选定。
    model_id: Optional[int] = None
    # 模型能力多模态提示（由后端校验后填回，告知前端是否需要更换为多模态模型）。
    # 字段仅输出，不接收；前端读这个判断是否展示"请选择多模态大模型"提示。
    needs_multimodal_hint: bool = False

    def normalized(self) -> "LlmReviewConfig":
        """清理后返回：未启用时 model_id 重置为 None。"""
        if not self.is_enabled:
            return LlmReviewConfig(
                is_enabled=False,
                model_id=None,
                needs_multimodal_hint=False,
            )
        return LlmReviewConfig(
            is_enabled=True,
            model_id=self.model_id,
            needs_multimodal_hint=False,
        )


class StrategyOut(ORMBase):
    id: int
    code: str
    name: str
    scope: StrategyScope
    description: Optional[str]
    is_active: bool
    effective_from: Optional[datetime]
    effective_until: Optional[datetime]
    definition: Dict[str, Any] = Field(default_factory=dict)
    service_config: Dict[str, Any] = Field(default_factory=dict)
    enabled_items: List[StrategyItemRef] = Field(default_factory=list)
    enabled_points: List[StrategyPointRef] = Field(default_factory=list)
    rule_set_id: Optional[int] = None
    disposition_rule_id: Optional[int] = None
    # 「大模型审核能力」总开关 + 选定的模型 ID（不按媒体类型拆分）。
    # 真相源仍是 strategies.definition.llm_review；这里上提到顶层以便前端读取。
    llm_review: LlmReviewConfig = Field(default_factory=lambda: LlmReviewConfig())
    created_at: datetime
    updated_at: Optional[datetime]   


class StrategyCreate(BaseModel):
    code: Optional[str] = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    scope: StrategyScope = StrategyScope.GENERAL
    description: Optional[str] = None
    is_active: bool = True
    effective_from: Optional[datetime] = None
    effective_until: Optional[datetime] = None
    services: List[str] = Field(default_factory=list)
    enabled_items: List[StrategyItemRef] = Field(default_factory=list)
    enabled_points: List[StrategyPointRef] = Field(default_factory=list)
    definition: Dict[str, Any] = Field(default_factory=dict)
    service_config: Dict[str, Any] = Field(default_factory=dict)
    # Phase B: 审批规则集 + 处置规则；新建策略必填（编辑接受 Optional）
    rule_set_id: Optional[int] = None
    disposition_rule_id: Optional[int] = None
    # 「大模型审核能力」总开关 + 选定的已激活大模型 ID（单一开关）。
    llm_review: LlmReviewConfig = Field(default_factory=lambda: LlmReviewConfig())


class StrategyUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    description: Optional[str] = None
    is_active: Optional[bool] = None
    effective_from: Optional[datetime] = None
    effective_until: Optional[datetime] = None
    services: Optional[List[str]] = None
    enabled_items: Optional[List[StrategyItemRef]] = None
    enabled_points: Optional[List[StrategyPointRef]] = None
    definition: Optional[Dict[str, Any]] = None
    service_config: Optional[Dict[str, Any]] = None
    # Phase B：编辑可改 rule_set / disposition 绑定
    rule_set_id: Optional[int] = None
    disposition_rule_id: Optional[int] = None
    # 「大模型审核能力」总开关 + 选定的已激活大模型 ID（单一开关）。
    llm_review: Optional[LlmReviewConfig] = None


class StrategyDuplicateRequest(BaseModel):
    name: Optional[str] = None


class StrategyValidateResult(BaseModel):
    ok: bool
    warnings: List[str] = Field(default_factory=list)
    checked_at: datetime
