"""WordSet schemas."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.wordset import WordSetAction, WordSetGroup, WordSetKind
from app.schemas.common import ORMBase


class WordSetOut(ORMBase):
    id: int
    code: str
    name: str
    group: WordSetGroup
    action: WordSetAction
    kind: Optional[WordSetKind] = None  # legacy
    description: Optional[str]
    is_active: bool
    word_count: int = 0
    ignored_services: List[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: Optional[datetime]


class WordSetCreate(BaseModel):
    code: Optional[str] = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=20)
    group: WordSetGroup = WordSetGroup.KEYWORD
    action: WordSetAction = WordSetAction.BLOCK
    kind: Optional[WordSetKind] = None  # 兼容旧客户端；后端忽略
    description: Optional[str] = Field(default=None, max_length=200)
    words: List[str] = Field(default_factory=list)

    @field_validator("words")
    @classmethod
    def _validate_words(cls, v: List[str]) -> List[str]:
        cleaned: List[str] = []
        for w in v:
            w = w.strip()
            if w:
                cleaned.append(w)
        if len(cleaned) > 1000:
            raise ValueError("单次最多 1000 个敏感词")
        return cleaned


class WordSetUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=20)
    group: Optional[WordSetGroup] = None
    action: Optional[WordSetAction] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    words: Optional[List[str]] = None
