"""Strategy schemas."""
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

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
    # 策略级 override；提交时透传到 strategies.definition.enabled_points，不写 audit_point
    medium_threshold: Optional[float] = Field(default=None, ge=50.0, le=100.0)
    high_threshold: Optional[float] = Field(default=None, ge=50.0, le=100.0)
    linked_library_ids: Optional[List[int]] = None


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


class StrategyDuplicateRequest(BaseModel):
    name: Optional[str] = None


class StrategyValidateResult(BaseModel):
    ok: bool
    warnings: List[str] = Field(default_factory=list)
    checked_at: datetime
