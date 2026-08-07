"""Auth + user schemas."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, model_validator

from app.models.user import UserRole
from app.schemas.common import ORMBase


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=255, description="用户名或邮箱")
    password: str = Field(min_length=6, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshRequest(BaseModel):
    refresh_token: str


class UserCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.SUBMITTER
    email: Optional[EmailStr] = None
    username: Optional[str] = Field(default=None, max_length=64)
    tenant_id: Optional[int] = None

    @model_validator(mode="after")
    def _at_least_one_identifier(self) -> "UserCreate":
        if not self.email and not self.username:
            raise ValueError("email 和 username 至少填写一个")
        return self


class UserOut(ORMBase):
    id: int
    email: Optional[EmailStr] = None
    username: Optional[str] = None
    full_name: str
    role: UserRole
    is_active: bool
    tenant_id: Optional[int] = None
    created_at: datetime


class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=128)
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
    username: Optional[str] = Field(default=None, max_length=64)
    tenant_id: Optional[int] = None
