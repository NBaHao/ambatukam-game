"""Room tickets: POST /api/rooms and /api/rooms/{code}/join."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app import rules
from app.db import MatchRepository
from app.services import tickets
from tests.conftest import FakeClock
from tests.test_api import OTHER_PID, PID
from tests.test_auth import PASSWORD, register

SECRET = "test-secret"


@pytest.fixture(autouse=True)
def fast_hashing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rules, "PW_ITERATIONS", 1000)


def create(client: TestClient, **overrides):
    body = {"mode": "double", "duration": 20, "pid": PID, "name": "Alice", **overrides}
    return client.post("/api/rooms", json=body)


def test_create_room_gives_a_host_ticket(client: TestClient, fake_clock: FakeClock):
    res = create(client)
    assert res.status_code == 200, res.text
    code, token = res.json()["code"], res.json()["ticket"]
    assert tickets.ROOM_CODE_RE.match(code)
    t = tickets.verify(SECRET, token, code, fake_clock.ms)
    assert t is not None
    assert (t.pid, t.name, t.registered, t.mode, t.duration) == (PID, "Alice", False, "double", 20)
    assert tickets.verify(SECRET, token, "zzzzzz", fake_clock.ms) is None  # other room
    assert tickets.verify("other-secret", token, code, fake_clock.ms) is None
    fake_clock.advance(rules.ROOM_TICKET_SEC + 1)
    assert tickets.verify(SECRET, token, code, fake_clock.ms) is None  # expired


@pytest.mark.parametrize(
    "overrides", [{"mode": "random", "duration": 0}, {"duration": 15}, {"name": ""}, {"pid": "x"}]
)
def test_create_room_validation(client: TestClient, overrides):
    assert create(client, **overrides).status_code == 422


def test_join_ticket_has_no_room_settings(client: TestClient, fake_clock: FakeClock):
    res = client.post("/api/rooms/abc234/join", json={"pid": OTHER_PID, "name": "Bob"})
    assert res.status_code == 200, res.text
    t = tickets.verify(SECRET, res.json()["ticket"], "abc234", fake_clock.ms)
    assert t is not None and t.mode is None and t.name == "Bob"


def test_join_rejects_bad_codes(client: TestClient):
    for code in ["ABC234", "abc23", "abc2340", "abc10o"]:
        assert client.post(f"/api/rooms/{code}/join", json={"pid": PID, "name": "x"}).status_code == 422


def test_logged_in_player_joins_as_their_account(client: TestClient, fake_clock: FakeClock):
    register(client)
    res = create(client, pid=OTHER_PID, name="Someone Else")
    t = tickets.verify(SECRET, res.json()["ticket"], res.json()["code"], fake_clock.ms)
    assert t is not None and (t.pid, t.name, t.registered) == (PID, "haro", True)


def test_guest_cannot_use_a_registered_name_or_device(client: TestClient):
    register(client)
    client.post("/api/auth/logout")
    assert create(client, pid=OTHER_PID, name="HARO").json() == {"error": "name_taken"}
    assert create(client, pid=PID, name="whoever").json() == {"error": "login_required"}
    client.post("/api/auth/login", json={"username": "haro", "password": PASSWORD})
    assert create(client, pid=PID, name="whoever").status_code == 200


def test_room_creation_is_rate_limited(client: TestClient, env):
    env.ROOM_LIMIT.limit_n = 2
    assert [create(client).status_code for _ in range(3)] == [200, 200, 429]


def test_tickets_are_not_run_tokens(client: TestClient):
    """A room ticket must not be accepted where a run token is expected (same secret)."""
    from app.services import tokens

    token = create(client).json()["ticket"]
    assert tokens.verify(SECRET, token) is None


def test_match_repository_records_a_round(env):
    record = {
        "id": "abc234-1-1",
        "room": "abc234",
        "mode": "single",
        "duration": 10,
        "started_at": 1,
        "ended_at": 2,
        "winner": None,
        "players": [
            {
                "pid": PID,
                "name": "a",
                "registered": True,
                "strokes": 3,
                "result": "draw",
                "status": "ok",
                "detail": {"bins": [3]},
            },
            {
                "pid": OTHER_PID,
                "name": "b",
                "registered": False,
                "strokes": 0,
                "result": "draw",
                "status": "forfeit",
                "detail": None,
            },
        ],
    }
    repo = MatchRepository(env.DB)
    asyncio.run(repo.record(record))
    asyncio.run(repo.record(record))  # recorded once
    rows = env.DB.conn.execute("SELECT winner FROM matches").fetchall()
    assert [tuple(r) for r in rows] == [(None,)]
    players = env.DB.conn.execute("SELECT pid, registered, detail FROM match_players ORDER BY pid").fetchall()
    assert sorted(tuple(r) for r in players) == sorted([(PID, 1, '{"bins": [3]}'), (OTHER_PID, 0, None)])
