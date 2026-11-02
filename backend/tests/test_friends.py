"""Friends API (/api/friends), lobby tickets (/api/lobby) and lobby message rules."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app import rules
from app.db import FriendRepository, UserRepository
from app.services import lobby, tickets
from tests.conftest import FakeClock
from tests.test_api import OTHER_PID, PID
from tests.test_auth import PASSWORD, register

SECRET = "test-secret"
THIRD_PID = "33333333-2222-3333-4444-555555555555"


@pytest.fixture(autouse=True)
def fast_hashing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rules, "PW_ITERATIONS", 1000)


def login(client: TestClient, username: str) -> None:
    res = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert res.status_code == 200, res.text


@pytest.fixture
def two(client: TestClient) -> TestClient:
    """Accounts haro and bob (logged in as bob)."""
    register(client)
    register(client, username="bob", pid=OTHER_PID)
    return client


def test_friends_need_login(client: TestClient):
    assert client.get("/api/friends").status_code == 401
    assert client.get("/api/friends").json() == {"error": "login_required"}
    assert client.post("/api/friends/haro").status_code == 401


def test_request_accept_and_remove(two: TestClient):
    c = two
    assert c.post("/api/friends/HARO").json() == {"relation": "outgoing"}
    assert c.post("/api/friends/haro").json() == {"relation": "outgoing"}  # idempotent
    body = c.get("/api/friends").json()
    assert body["friends"] == [] and [r["username"] for r in body["outgoing"]] == ["haro"]
    assert c.get("/api/users/haro").json()["relation"] == "outgoing"

    login(c, "haro")
    assert [r["username"] for r in c.get("/api/friends").json()["incoming"]] == ["bob"]
    assert c.get("/api/users/bob").json()["relation"] == "incoming"
    assert c.get("/api/users/haro").json()["relation"] == "self"
    assert c.post("/api/friends/bob").json() == {"relation": "friends"}  # accepting = adding back
    body = c.get("/api/friends").json()
    assert [f["username"] for f in body["friends"]] == ["bob"]
    assert body["incoming"] == body["outgoing"] == []

    login(c, "bob")
    assert c.get("/api/users/haro").json()["relation"] == "friends"
    assert c.delete("/api/friends/haro").json() == {"relation": "none"}
    login(c, "haro")
    assert c.get("/api/friends").json()["friends"] == []


def test_decline_and_cancel(two: TestClient):
    c = two
    c.post("/api/friends/haro")
    c.delete("/api/friends/haro")  # bob cancels
    login(c, "haro")
    assert c.get("/api/friends").json()["incoming"] == []
    c.post("/api/friends/bob")
    login(c, "bob")
    c.delete("/api/friends/haro")  # bob declines
    login(c, "haro")
    assert c.get("/api/friends").json()["outgoing"] == []


def test_crossing_requests_become_one_friendship(two: TestClient, env):
    c = two
    users, repo = UserRepository(env.DB), FriendRepository(env.DB)
    haro, bob = (asyncio.run(users.by_username(u)) for u in ("haro", "bob"))
    # Both send a request at once (raced past the relation check): two pending rows
    asyncio.run(repo.create(bob["id"], haro["id"], 1))
    asyncio.run(repo.create(haro["id"], bob["id"], 2))
    login(c, "haro")
    assert c.post("/api/friends/bob").json() == {"relation": "friends"}
    assert len(asyncio.run(repo.between(haro["id"], bob["id"]))) == 1
    body = c.get("/api/friends").json()
    assert [f["username"] for f in body["friends"]] == ["bob"] and body["outgoing"] == body["incoming"] == []


def test_friend_errors(two: TestClient, monkeypatch: pytest.MonkeyPatch):
    c = two
    assert c.post("/api/friends/nobody").json() == {"error": "user_not_found"}
    assert c.post("/api/friends/bob").json() == {"error": "cannot_friend_self"}
    assert c.post("/api/friends/x").status_code == 422
    monkeypatch.setattr(rules, "MAX_FRIEND_REQUESTS", 1)
    register(c, username="carol", pid=THIRD_PID)
    login(c, "bob")
    assert c.post("/api/friends/haro").json() == {"relation": "outgoing"}
    res = c.post("/api/friends/carol")
    assert res.status_code == 409 and res.json() == {"error": "too_many_requests"}


def test_friend_limit_blocks_accepting(two: TestClient, monkeypatch: pytest.MonkeyPatch):
    c = two
    register(c, username="carol", pid=THIRD_PID)
    c.post("/api/friends/haro")
    login(c, "haro")
    c.post("/api/friends/carol")  # carol has it pending
    login(c, "carol")
    c.post("/api/friends/haro")  # haro and carol are friends
    monkeypatch.setattr(rules, "MAX_FRIENDS", 1)
    login(c, "haro")
    res = c.post("/api/friends/bob")
    assert res.status_code == 409 and res.json() == {"error": "too_many_friends"}


def test_friend_names_and_link(two: TestClient, env):
    c = two
    repo = FriendRepository(env.DB)
    c.post("/api/friends/haro")
    assert asyncio.run(repo.link("bob", "haro")) == "pending"
    assert asyncio.run(repo.friend_names("haro")) == []
    login(c, "haro")
    c.post("/api/friends/bob")
    assert asyncio.run(repo.link("haro", "bob")) == "friends"
    assert asyncio.run(repo.friend_names("bob")) == ["haro"]
    assert asyncio.run(repo.link("haro", "nobody")) is None


def test_lobby_ticket(client: TestClient, fake_clock: FakeClock):
    res = client.post("/api/lobby", json={"pid": PID, "name": "Guesty"})
    assert res.status_code == 200, res.text
    token = res.json()["ticket"]
    t = tickets.verify(SECRET, token, tickets.LOBBY, fake_clock.ms)
    assert t is not None and (t.pid, t.name, t.registered) == (PID, "Guesty", False)
    register(client)
    mine = client.post("/api/lobby", json={"pid": PID, "name": "x"}).json()["ticket"]
    t = tickets.verify(SECRET, mine, tickets.LOBBY, fake_clock.ms)
    assert t is not None and (t.name, t.registered) == ("haro", True)
    fake_clock.advance(rules.LOBBY_TICKET_SEC + 1)
    assert tickets.verify(SECRET, token, tickets.LOBBY, fake_clock.ms) is None


def test_lobby_and_room_tickets_are_not_interchangeable(client: TestClient, fake_clock: FakeClock):
    lobby_token = client.post("/api/lobby", json={"pid": PID, "name": "A"}).json()["ticket"]
    room = client.post("/api/rooms", json={"mode": "single", "duration": 10, "pid": PID, "name": "A"}).json()
    assert tickets.verify(SECRET, lobby_token, room["code"], fake_clock.ms) is None
    assert tickets.verify(SECRET, room["ticket"], tickets.LOBBY, fake_clock.ms) is None


def test_lobby_ticket_for_a_registered_name_needs_login(client: TestClient):
    register(client)
    client.post("/api/auth/logout")
    res = client.post("/api/lobby", json={"pid": OTHER_PID, "name": "Haro"})
    assert res.json() == {"error": "name_taken"}


@pytest.mark.parametrize(
    ("msg", "ok"),
    [
        ({"to": "bob", "code": "abc234", "mode": "single", "duration": 10}, True),
        ({"to": "bob", "code": "abc234", "mode": "double", "duration": 20}, True),
        ({"to": "bob", "code": "abc234", "mode": "random", "duration": 0}, False),
        ({"to": "bob", "code": "abc234", "mode": "single", "duration": 15}, False),
        ({"to": "bob", "code": "abc234", "mode": "single", "duration": True}, False),
        ({"to": "bob", "code": "ABC234", "mode": "single", "duration": 10}, False),
        ({"to": "b", "code": "abc234", "mode": "single", "duration": 10}, False),
        ({"to": 5, "code": "abc234", "mode": "single", "duration": 10}, False),
        ({"code": "abc234", "mode": "single", "duration": 10}, False),
    ],
)
def test_lobby_invite_validation(msg, ok):
    assert (lobby.invite(msg) is not None) == ok


def test_lobby_throttle():
    th = lobby.Throttle(2000)
    assert th.allow("a", 0) and not th.allow("a", 1999) and th.allow("a", 2000)
    assert th.allow("b", 100)


def test_queue_board_validation():
    assert lobby.queue_board({"mode": "double", "duration": 30}) == ("double", 30)
    for bad in ({"mode": "random", "duration": 0}, {"mode": "single", "duration": 15}, {"mode": "single"}):
        assert lobby.queue_board(bad) is None


def test_pick_opponent_oldest_on_same_board_not_me():
    me = {"pid": "p1", "q": {"m": "single", "d": 10, "at": 50}}
    others = [
        {"pid": "p1", "q": {"m": "single", "d": 10, "at": 1}},  # my other tab
        {"pid": "p2", "q": {"m": "single", "d": 20, "at": 2}},  # other board
        {"pid": "p3", "q": {"m": "double", "d": 10, "at": 3}},
        {"pid": "p4"},  # not searching
        {"pid": "p5", "q": {"m": "single", "d": 10, "at": 9}},
        {"pid": "p6", "q": {"m": "single", "d": 10, "at": 4}},
    ]
    assert lobby.pick_opponent(me, others)["pid"] == "p6"
    assert lobby.pick_opponent(me, others[:4]) is None
