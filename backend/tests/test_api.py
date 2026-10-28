from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import TEST_CAPTCHA_OK, FakeClock

PID = "11111111-2222-3333-4444-555555555555"
OTHER_PID = "99999999-2222-3333-4444-555555555555"
BINS = [3, 4, 4, 5, 4, 4, 4, 4, 4, 3]


def start(client: TestClient, mode: str = "single", duration: int = 10) -> str:
    res = client.post("/api/session", json={"mode": mode, "duration": duration})
    assert res.status_code == 200, res.text
    return res.json()["token"]


def score_body(token: str, **overrides: Any) -> dict[str, Any]:
    body = {
        "token": token,
        "captcha": TEST_CAPTCHA_OK,
        "pid": PID,
        "name": "Ha  ro​",
        "strokes": sum(BINS),
        "bins": BINS,
        "fps": 30,
        "grip": 90,
    }
    return {**body, **overrides}


def test_full_flow_submit_rename_and_board(client: TestClient, fake_clock: FakeClock):
    token = start(client)
    fake_clock.advance(10)
    res = client.post("/api/score", json=score_body(token))
    assert res.status_code == 200, res.text
    assert res.json() == {"name": "Ha ro", "score": 39, "strokes": 39, "rank": 1, "total": 1}

    # Nộp lại cùng ván để đổi tên
    res = client.post("/api/score", json=score_body(token, name="Haro"))
    assert res.json()["name"] == "Haro"

    board = client.get("/api/leaderboard", params={"mode": "single", "duration": 10, "pid": PID}).json()
    assert board["entries"] == [{"name": "Haro", "score": 39, "strokes": 39, "me": True}]
    assert board["me"]["rank"] == 1


def test_token_reuse_by_other_player_or_score(client: TestClient, fake_clock: FakeClock):
    token = start(client)
    fake_clock.advance(10)
    assert client.post("/api/score", json=score_body(token)).status_code == 200
    res = client.post("/api/score", json=score_body(token, pid=OTHER_PID))
    assert res.json() == {"error": "used"}
    bins = [*BINS[:-1], 4]
    res = client.post("/api/score", json=score_body(token, bins=bins, strokes=sum(bins)))
    assert res.json() == {"error": "used"}


def test_too_fast_and_expired(client: TestClient, fake_clock: FakeClock):
    token = start(client)
    fake_clock.advance(5)
    assert client.post("/api/score", json=score_body(token)).json() == {"error": "too_fast"}
    fake_clock.advance(1000)
    assert client.post("/api/score", json=score_body(token)).json() == {"error": "expired"}


def test_captcha_required(client: TestClient, fake_clock: FakeClock):
    token = start(client)
    fake_clock.advance(10)
    assert client.post("/api/score", json=score_body(token, captcha="")).json() == {"error": "captcha"}


def test_implausible_and_invalid(client: TestClient, fake_clock: FakeClock):
    token = start(client)
    fake_clock.advance(10)
    assert client.post("/api/score", json=score_body(token, grip=5)).json() == {"error": "implausible"}
    res = client.post("/api/score", json=score_body(token, strokes="39"))
    assert (res.status_code, res.json()) == (422, {"error": "invalid_request"})
    assert client.post("/api/score", json=score_body("bad.token")).json() == {"error": "bad_token"}


def test_random_mode(client: TestClient, fake_clock: FakeClock):
    token = start(client, "random", 0)
    fake_clock.advance(24)
    bins = [3] * 23 + [1]
    res = client.post("/api/score", json=score_body(token, bins=bins, strokes=sum(bins), survived=23.44))
    assert res.json()["score"] == 23.4
    token = start(client, "random", 0)
    fake_clock.advance(24)
    res = client.post("/api/score", json=score_body(token, bins=bins, strokes=sum(bins)))
    assert res.json() == {"error": "bad_score"}


def test_session_validation_and_rate_limit(client: TestClient, env):
    assert client.post("/api/session", json={"mode": "single", "duration": 15}).status_code == 422
    assert client.post("/api/session", json={"mode": "random", "duration": 10}).status_code == 422
    env.SESSION_LIMIT.limit_n = 0
    res = client.post("/api/session", json={"mode": "single", "duration": 10})
    assert (res.status_code, res.json()) == (429, {"error": "rate_limited"})


def test_leaderboard_validation(client: TestClient):
    res = client.get("/api/leaderboard", params={"mode": "single", "duration": 0})
    assert res.json() == {"error": "bad_mode"}
    assert client.get("/api/leaderboard", params={"mode": "random", "duration": 0}).json() == {
        "entries": [],
        "me": None,
    }
    assert client.get("/api/nope").json() == {"error": "not_found"}
