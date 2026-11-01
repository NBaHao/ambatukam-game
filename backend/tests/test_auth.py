import asyncio
import hashlib
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import rules
from app.services import passwords
from tests.conftest import TEST_CAPTCHA_OK, FakeClock
from tests.test_api import OTHER_PID, PID, score_body, start

PASSWORD = "hunter2-hunter2"


@pytest.fixture(autouse=True)
def fast_hashing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rules, "PW_ITERATIONS", 1000)


def register(client: TestClient, **overrides: Any):
    body = {"username": "Haro", "password": PASSWORD, "pid": PID, "captcha": TEST_CAPTCHA_OK, **overrides}
    return client.post("/api/auth/register", json=body)


def submit(client: TestClient, fake_clock: FakeClock, **overrides: Any):
    token = start(client)
    fake_clock.advance(10)
    return client.post("/api/score", json=score_body(token, **overrides))


def test_register_logs_in_and_lowercases_username(client: TestClient):
    assert client.get("/api/users/haro/exists").json() == {"exists": False}
    res = register(client)
    assert res.status_code == 200, res.text
    user = res.json()["user"]
    assert user["username"] == "haro"
    assert user["pid"] == PID
    cookie = res.headers["set-cookie"]
    assert "amb_sid=" in cookie and "HttpOnly" in cookie and "Secure" in cookie and "Path=/api" in cookie
    assert client.get("/api/me").json()["user"]["username"] == "haro"
    assert client.get("/api/users/HARO/exists").json() == {"exists": True}


@pytest.mark.parametrize(
    "overrides",
    [
        {"username": "ab"},
        {"username": "has space"},
        {"username": "guest-123"},
        {"password": "short"},
        {"email": "not-an-email"},
    ],
)
def test_register_validation(client: TestClient, overrides: dict[str, Any]):
    assert register(client, **overrides).status_code == 422


def test_register_needs_captcha_and_unique_username(client: TestClient):
    assert register(client, captcha="nope").json() == {"error": "captcha"}
    assert register(client, email="Me@Example.com").status_code == 200
    client.post("/api/auth/logout")
    res = register(client, pid=OTHER_PID)
    assert res.status_code == 409
    assert res.json() == {"error": "username_taken"}


def test_register_takes_over_existing_scores(client: TestClient, fake_clock: FakeClock):
    assert submit(client, fake_clock, name="Old Name").status_code == 200
    register(client)
    board = client.get("/api/leaderboard", params={"mode": "single", "duration": 10}).json()
    assert board["entries"][0]["name"] == "haro"
    assert board["entries"][0]["registered"] is True


def test_register_with_pid_owned_by_another_account_gets_fresh_pid(client: TestClient):
    register(client)
    client.post("/api/auth/logout")
    user = register(client, username="other").json()["user"]
    assert user["pid"] != PID


def test_login_logout(client: TestClient):
    register(client)
    client.post("/api/auth/logout")
    assert client.get("/api/me").json() == {"user": None}

    bad = client.post("/api/auth/login", json={"username": "haro", "password": "wrong-password"})
    assert bad.status_code == 401 and bad.json() == {"error": "bad_login"}
    unknown = client.post("/api/auth/login", json={"username": "nobody", "password": PASSWORD})
    assert unknown.json() == {"error": "bad_login"}

    res = client.post("/api/auth/login", json={"username": "HaRo", "password": PASSWORD})
    assert res.status_code == 200, res.text
    assert res.json()["user"]["pid"] == PID
    assert client.get("/api/me").json()["user"]["username"] == "haro"


def test_login_rehashes_weaker_passwords(client: TestClient, env, monkeypatch: pytest.MonkeyPatch):
    register(client)
    monkeypatch.setattr(rules, "PW_ITERATIONS", 2000)
    client.post("/api/auth/login", json={"username": "haro", "password": PASSWORD})
    row = env.DB.conn.execute("SELECT pw_iter FROM users").fetchone()
    assert row["pw_iter"] == 2000


def test_session_expires_and_renews(client: TestClient, fake_clock: FakeClock, env):
    register(client)
    fake_clock.advance((rules.SESSION_DAYS - 1) * 86_400)
    assert client.get("/api/me").json()["user"] is not None  # renewed: 30 days from now
    fake_clock.advance(20 * 86_400)
    assert client.get("/api/me").json()["user"] is not None
    fake_clock.advance(31 * 86_400)
    assert client.get("/api/me").json() == {"user": None}


def test_logged_in_score_uses_account_name_and_pid(client: TestClient, fake_clock: FakeClock):
    register(client)
    res = submit(client, fake_clock, name="Someone Else", pid=OTHER_PID)
    assert res.status_code == 200, res.text
    assert res.json()["name"] == "haro"
    board = client.get("/api/leaderboard", params={"mode": "single", "duration": 10, "pid": PID}).json()
    assert board["me"]["name"] == "haro"


def test_guest_cannot_use_account_pid_or_username(client: TestClient, fake_clock: FakeClock):
    register(client)
    client.post("/api/auth/logout")
    res = submit(client, fake_clock)
    assert res.status_code == 401 and res.json() == {"error": "login_required"}
    res = submit(client, fake_clock, pid=OTHER_PID, name="HARO")
    assert res.status_code == 409 and res.json() == {"error": "name_taken"}
    assert submit(client, fake_clock, pid=OTHER_PID, name="haro fan").status_code == 200


def test_auth_is_rate_limited(client: TestClient, env):
    env.AUTH_LIMIT.limit_n = 0
    res = client.post("/api/auth/login", json={"username": "haro", "password": PASSWORD})
    assert res.status_code == 429


def test_password_hash_roundtrip():
    async def kdf(p: bytes, s: bytes, n: int) -> bytes:
        return hashlib.pbkdf2_hmac("sha256", p, s, n)

    async def check() -> None:
        stored = await passwords.hash_password(kdf, PASSWORD, 1000)
        assert len(stored.salt) == 32 and stored.iterations == 1000
        assert await passwords.verify_password(kdf, PASSWORD, stored)
        assert not await passwords.verify_password(kdf, PASSWORD + "x", stored)

    asyncio.run(check())
