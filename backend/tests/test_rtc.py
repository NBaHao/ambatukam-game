"""POST /api/rooms/{code}/ice: ICE / TURN servers for PvP video, players of the room only."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_turn_post
from app.main import app
from tests.test_api import PID

TURN_RESPONSE = {
    "iceServers": [
        {"urls": ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"]},
        {
            "urls": [
                "turn:turn.cloudflare.com:3478?transport=udp",
                "turn:turn.cloudflare.com:53?transport=udp",
                "turns:turn.cloudflare.com:443?transport=tcp",
            ],
            "username": "u",
            "credential": "c",
        },
    ]
}


@pytest.fixture
def turn_calls(client: TestClient) -> list[tuple[str, dict[str, Any], dict[str, str]]]:
    calls: list[tuple[str, dict[str, Any], dict[str, str]]] = []

    async def post(url: str, body: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        calls.append((url, body, headers))
        return TURN_RESPONSE

    app.dependency_overrides[get_turn_post] = lambda: post
    return calls


def room(client: TestClient) -> tuple[str, str]:
    res = client.post("/api/rooms", json={"mode": "single", "duration": 10, "pid": PID, "name": "A"}).json()
    return res["code"], res["ticket"]


def test_off_without_turn(client: TestClient, turn_calls):
    code, ticket = room(client)
    res = client.post(f"/api/rooms/{code}/ice", json={"ticket": ticket})
    assert res.status_code == 503 and res.json() == {"error": "rtc_unavailable"}
    assert turn_calls == []


def test_turn_relay_for_room_players(client: TestClient, env, turn_calls):
    env.TURN_KEY_ID, env.TURN_KEY_API_TOKEN = "key123", "tok456"
    code, ticket = room(client)
    res = client.post(f"/api/rooms/{code}/ice", json={"ticket": ticket})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["relay"] is True
    urls = [u for s in body["ice_servers"] for u in s["urls"]]
    assert not any(":53" in u for u in urls)  # browsers block port 53
    assert body["ice_servers"][1]["credential"] == "c"
    url, sent, headers = turn_calls[0]
    assert "key123" in url and headers == {"Authorization": "Bearer tok456"} and sent["ttl"] > 0
    # Another room's ticket (or none) gets nothing
    other = client.post("/api/rooms/zzzzzz/ice", json={"ticket": ticket})
    assert other.status_code == 403 and len(turn_calls) == 1


def test_direct_mode_for_local_dev(client: TestClient, env, turn_calls):
    env.RTC_ALLOW_DIRECT = "1"
    code, ticket = room(client)
    body = client.post(f"/api/rooms/{code}/ice", json={"ticket": ticket}).json()
    assert body["relay"] is False and turn_calls == []


def test_turn_failure_is_503(client: TestClient, env):
    env.TURN_KEY_ID, env.TURN_KEY_API_TOKEN = "key123", "tok456"

    async def broken(*_: Any) -> dict[str, Any]:
        raise RuntimeError("TURN API 500")

    app.dependency_overrides[get_turn_post] = lambda: broken
    code, ticket = room(client)
    assert client.post(f"/api/rooms/{code}/ice", json={"ticket": ticket}).status_code == 503
