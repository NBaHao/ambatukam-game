"""Chạy FastAPI app bằng CPython thường: D1 giả bằng sqlite3 (áp đúng migrations), rate limit giả,
Turnstile giả. Không cần runtime Workers."""

import sqlite3
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.dependencies import get_human_verifier
from app.main import app

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
TEST_CAPTCHA_OK = "captcha-ok"


class FakeStatement:
    def __init__(self, db: "FakeD1", query: str, params: tuple[Any, ...] = ()) -> None:
        self.db, self.query, self.params = db, query, params

    def bind(self, *values: Any) -> "FakeStatement":
        return FakeStatement(self.db, self.query, values)

    def execute(self) -> dict[str, Any]:
        cur = self.db.conn.execute(self.query, self.params)
        return {"results": [dict(r) for r in cur.fetchall()], "success": True}

    async def all(self) -> dict[str, Any]:
        with self.db.conn:
            return self.execute()


class FakeD1:
    def __init__(self) -> None:
        self.conn = sqlite3.connect(":memory:", check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        for f in sorted(MIGRATIONS.glob("*.sql")):
            self.conn.executescript(f.read_text())

    def prepare(self, query: str) -> FakeStatement:
        return FakeStatement(self, query)

    async def batch(self, statements: list[FakeStatement]) -> list[dict[str, Any]]:
        with self.conn:  # D1 chạy cả batch trong một transaction
            return [s.execute() for s in statements]


class FakeRateLimiter:
    def __init__(self, limit: int) -> None:
        self.limit_n, self.hits = limit, 0

    async def limit(self, options: dict[str, str]) -> dict[str, bool]:
        self.hits += 1
        return {"success": self.hits <= self.limit_n}


class FakeClock:
    def __init__(self) -> None:
        self.ms = 1_800_000_000_000

    def advance(self, seconds: float) -> None:
        self.ms += int(seconds * 1000)


@pytest.fixture
def env() -> SimpleNamespace:
    return SimpleNamespace(
        DB=FakeD1(),
        SESSION_LIMIT=FakeRateLimiter(1000),
        SCORE_LIMIT=FakeRateLimiter(1000),
        TOKEN_SECRET="test-secret",
        TURNSTILE_SECRET="test-turnstile",
    )


@pytest.fixture
def fake_clock(monkeypatch: pytest.MonkeyPatch) -> FakeClock:
    c = FakeClock()
    monkeypatch.setattr(clock, "now_ms", lambda: c.ms)
    return c


@pytest.fixture
def client(env: SimpleNamespace, fake_clock: FakeClock) -> TestClient:
    async def verify_human(token: str) -> bool:
        return token == TEST_CAPTCHA_OK

    async def with_env(scope: dict, receive: Any, send: Any) -> None:
        # Giống asgi.fetch của Workers: binding nằm ở scope["env"]
        await app({**scope, "env": env}, receive, send)

    app.dependency_overrides[get_human_verifier] = lambda: verify_human
    try:
        yield TestClient(with_env)
    finally:
        app.dependency_overrides.clear()
