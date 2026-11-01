"""Request / response của API. Lỗi kiểu dữ liệu → 422 {"error": "invalid_request"}."""

from typing import Annotated, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    Field,
    FiniteFloat,
    StrictInt,
    model_validator,
)

from app.rules import (
    NAME_MAX,
    PASSWORD_MAX,
    PASSWORD_MIN,
    RESERVED_PREFIX,
    USERNAME_PATTERN,
    Mode,
    is_valid_duration,
)
from app.services.names import clean_name

PlayerId = Annotated[str, Field(pattern=r"^[A-Za-z0-9-]{8,64}$")]
Count = Annotated[StrictInt, Field(ge=0)]
PlayerName = Annotated[str, Field(max_length=NAME_MAX * 8), AfterValidator(clean_name), Field(min_length=1)]


def _lower(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


def _not_reserved(value: str) -> str:
    if value.startswith(RESERVED_PREFIX):
        raise ValueError("this username is reserved")
    return value


# Usernames are case-insensitive: always stored and compared in lowercase
Username = Annotated[str, BeforeValidator(_lower), Field(pattern=USERNAME_PATTERN)]
NewUsername = Annotated[Username, AfterValidator(_not_reserved)]
Password = Annotated[str, Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)]
Email = Annotated[str, BeforeValidator(_lower), Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")]


class SessionRequest(BaseModel):
    mode: Mode
    duration: StrictInt  # 10/20/30 cho single/double, 0 cho random

    @model_validator(mode="after")
    def _duration_matches_mode(self) -> Self:
        if not is_valid_duration(self.mode, self.duration):
            raise ValueError("duration is not valid for this mode")
        return self


class SessionResponse(BaseModel):
    token: str


class ScoreRequest(BaseModel):
    token: str = Field(max_length=512)
    captcha: str = Field(max_length=2048)  # mã Turnstile
    pid: PlayerId
    name: PlayerName
    strokes: Count
    survived: FiniteFloat | None = None  # random: số giây sống sót
    bins: list[Count] = Field(max_length=200)
    fps: FiniteFloat
    grip: Count
    split: list[Count] | None = Field(default=None, max_length=2)  # double


class RankResponse(BaseModel):
    name: str
    score: float
    strokes: int
    rank: int
    total: int


class LeaderboardEntry(BaseModel):
    name: str
    score: float
    strokes: int
    me: bool
    registered: bool  # the entry belongs to an account (name is its username)


class LeaderboardResponse(BaseModel):
    entries: list[LeaderboardEntry]
    me: RankResponse | None


class UsernameExistsResponse(BaseModel):
    exists: bool


class RegisterRequest(BaseModel):
    username: NewUsername
    password: Password
    email: Email | None = None
    pid: PlayerId  # this device's player id: its scores move into the new account
    captcha: str = Field(max_length=2048)


class LoginRequest(BaseModel):
    username: Username
    password: Annotated[str, Field(min_length=1, max_length=PASSWORD_MAX)]


class User(BaseModel):
    username: str
    pid: str  # the client stores this as its player id
    created_at: int


class MeResponse(BaseModel):
    user: User | None


class ErrorResponse(BaseModel):
    error: str
