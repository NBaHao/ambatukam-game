"""GET /api/users/{username}: public profile of an account."""

import asyncio
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import rules
from app.db import MatchRepository
from tests.conftest import FakeClock
from tests.test_api import OTHER_PID, PID
from tests.test_auth import register, submit

THIRD_PID = "33333333-2222-3333-4444-555555555555"


@pytest.fixture(autouse=True)
def fast_hashing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rules, "PW_ITERATIONS", 1000)


def record(env, n: int, a: tuple[str, str, bool, int, str], b: tuple[str, str, bool, int, str], **kw: Any):
    """One PvP round: (pid, name, registered, strokes, result) for each player."""
    players = [
        {
            "pid": p,
            "name": name,
            "registered": reg,
            "strokes": st,
            "result": res,
            "status": "ok",
            "detail": None,
        }
        for p, name, reg, st, res in (a, b)
    ]
    winner = next((p["pid"] for p in players if p["result"] == "win"), None)
    match = {
        "id": f"abc234-1-{n}",
        "room": "abc234",
        "mode": "single",
        "duration": 10,
        "started_at": n * 1000,
        "ended_at": n * 1000 + 10_000,
        "winner": winner,
        "players": players,
        **kw,
    }
    asyncio.run(MatchRepository(env.DB).record(match))


def test_unknown_or_bad_username(client: TestClient):
    assert client.get("/api/users/nobody").status_code == 404
    assert client.get("/api/users/nobody").json() == {"error": "user_not_found"}
    assert client.get("/api/users/x").status_code == 422


def test_profile_shows_records_pvp_and_matches(client: TestClient, fake_clock: FakeClock, env):
    register(client)
    assert submit(client, fake_clock).status_code == 200
    # A guest scores higher on the same board: haro is #2
    client.post("/api/auth/logout")
    submit(client, fake_clock, pid=OTHER_PID, name="Guest", strokes=60, bins=[6, 6, 6, 6, 6, 6, 6, 6, 5, 7])
    # Second account
    register(client, username="bob", pid=THIRD_PID)

    record(env, 1, (PID, "haro", True, 40, "win"), (OTHER_PID, "Guest", False, 30, "loss"))
    record(env, 2, (PID, "haro", True, 20, "loss"), (THIRD_PID, "bob", True, 25, "win"))
    record(env, 3, (PID, "haro", True, 22, "draw"), (OTHER_PID, "Guest", False, 22, "draw"))

    res = client.get("/api/users/HARO")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["username"] == "haro"
    assert [(r["mode"], r["duration"], r["rank"], r["total"]) for r in body["records"]] == [
        ("single", 10, 2, 2)
    ]
    assert body["pvp"] == {"played": 3, "wins": 1, "losses": 1, "draws": 1}
    matches = body["matches"]
    assert [m["id"] for m in matches] == ["abc234-1-3", "abc234-1-2", "abc234-1-1"]  # newest first
    assert matches[1]["opponent"] == {"name": "bob", "username": "bob", "strokes": 25, "status": "ok"}
    assert matches[0]["opponent"]["username"] is None  # guests have no profile
    for pid in (PID, OTHER_PID, THIRD_PID):
        assert pid not in res.text  # no player ids leak


def test_guest_named_like_an_account_does_not_link_to_it(client: TestClient, env):
    register(client)
    register(client, username="bob", pid=THIRD_PID)
    # This "bob" played as a guest from the same device id before (registered = 0): no link
    record(env, 1, (PID, "haro", True, 10, "win"), (THIRD_PID, "bob", False, 5, "loss"))
    m = client.get("/api/users/haro").json()["matches"][0]
    assert m["opponent"]["username"] is None


def test_new_account_has_an_empty_profile(client: TestClient):
    register(client)
    body = client.get("/api/users/haro").json()
    assert body["records"] == [] and body["matches"] == []
    assert body["pvp"] == {"played": 0, "wins": 0, "losses": 0, "draws": 0}


def test_profile_is_rate_limited(client: TestClient, env):
    register(client)
    env.SESSION_LIMIT.limit_n = 1
    assert [client.get("/api/users/haro").status_code for _ in range(2)] == [200, 429]
