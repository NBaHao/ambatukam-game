"""PvP room rules (app/services/room.py), driven without the Durable Object."""

from typing import Any

import pytest

from app import rules
from app.services.room import RoomError, RoomLogic, pong
from app.services.tickets import Ticket

T0 = 1_800_000_000_000
A, B, C = "pid-aaaaaaaa", "pid-bbbbbbbb", "pid-cccccccc"


def ticket(pid: str, name: str, *, host: bool = False, mode: str = "single", duration: int = 10) -> Ticket:
    return Ticket(
        room="abc234",
        pid=pid,
        name=name,
        registered=False,
        expires_ms=T0 + 10**9,
        mode=mode if host else None,
        duration=duration if host else None,
    )


def final_body(strokes: int, duration: int = 10, **overrides: Any) -> dict[str, Any]:
    per, extra = divmod(strokes, duration)
    bins = [per + (1 if i < extra else 0) for i in range(duration)]
    if strokes >= rules.MIN_STROKES_FLAT and len(set(bins)) == 1:
        bins[0] += 1
        bins[1] -= 1
    return {"t": "final", "strokes": strokes, "bins": bins, "fps": 30.0, "grip": 95, **overrides}


class Match:
    """Two players in a room: helpers that keep the state between events like the DO does."""

    def __init__(self, mode: str = "single", duration: int = 10) -> None:
        self.state: dict[str, Any] | None = None
        self.now = T0
        self.record: dict[str, Any] | None = None
        self.alarm_at: int | None = None
        self.run("join", ticket(A, "alice", host=True, mode=mode, duration=duration), "ca")
        self.run("join", ticket(B, "bob"), "cb")

    def run(self, method: str, *args: Any) -> list[Any]:
        room = RoomLogic(self.state)
        outs = getattr(room, method)(*args, self.now) if method != "join" else room.join(*args, self.now)
        self.state = room.state
        self.record = room.record or self.record
        self.alarm_at = room.alarm_at if room.alarm_at is not None else self.alarm_at
        self.expired = room.expired
        return outs

    def start(self) -> int:
        self.run("set_ready", A, "ca", True)
        self.run("set_ready", B, "cb", True)
        assert self.state and self.state["match"]
        return self.state["match"]["at"]

    def at_end(self) -> None:
        self.now = self.state["match"]["at"] + self.state["duration"] * 1000 + 200  # type: ignore[index]


def msgs(outs: list[Any], to: str, kind: str) -> list[dict[str, Any]]:
    return [o.msg for o in outs if o.to == to and o.msg["t"] == kind]


def test_room_needs_its_creator_first():
    with pytest.raises(RoomError) as err:
        RoomLogic(None).join(ticket(B, "bob"), "cb", T0)
    assert err.value.code == "room_not_found"


def test_join_shares_state_without_leaking_pids():
    m = Match(mode="double", duration=20)
    view = m.run("join", ticket(B, "bob"), "cb2")  # reconnect: same seat
    snap = msgs(view, B, "state")[0]
    assert snap["mode"] == "double" and snap["duration"] == 20
    assert snap["you"] == 1
    assert [p["name"] for p in snap["players"]] == ["alice", "bob"]
    assert A not in repr(snap) and B not in repr(snap)


def test_third_player_is_turned_away_but_can_take_an_empty_seat():
    m = Match()
    with pytest.raises(RoomError) as err:
        m.run("join", ticket(C, "carol"), "cc")
    assert err.value.code == "room_full"
    m.start()
    m.at_end()
    m.run("final", A, "ca", final_body(40))
    m.run("final", B, "cb", final_body(30))
    m.run("leave", B, "cb")
    outs = m.run("join", ticket(C, "carol"), "cc")
    snap = msgs(outs, C, "state")[0]
    assert [p["name"] for p in snap["players"]] == ["alice", "carol"]
    assert all(p["wins"] == 0 for p in snap["players"])  # new opponent: score starts over


def test_match_starts_when_both_are_ready_with_a_shared_clock():
    m = Match()
    outs = m.run("set_ready", A, "ca", True)
    assert m.state["match"] is None  # type: ignore[index]
    assert msgs(outs, B, "state")[0]["players"][0]["ready"] is True
    outs = m.run("set_ready", B, "cb", True)
    at = m.state["match"]["at"]  # type: ignore[index]
    assert at == T0 + rules.PVP_START_DELAY_MS
    assert msgs(outs, A, "state")[0]["match"] == {"round": 1, "at": at}
    assert msgs(outs, B, "state")[0]["match"] == {"round": 1, "at": at}
    assert m.alarm_at == at + 10_000 + rules.PVP_FINAL_GRACE_MS


def test_disconnected_player_does_not_count_as_ready():
    m = Match()
    m.run("set_ready", A, "ca", True)
    m.run("leave", A, "ca")
    m.run("set_ready", B, "cb", True)
    assert m.state["match"] is None  # type: ignore[index]


def test_stale_connection_is_ignored():
    m = Match()
    m.run("join", ticket(A, "alice"), "ca-new")
    assert m.run("set_ready", A, "ca", True) == []  # old tab
    m.run("leave", A, "ca")  # the old tab closing doesn't disconnect the new one
    assert m.state["players"][0]["connected"] is True  # type: ignore[index]


def test_progress_is_relayed_to_the_opponent():
    m = Match()
    at = m.start()
    m.now = at + 2000
    outs = m.run("progress", A, "ca", 9)
    assert [(o.to, o.msg) for o in outs] == [(B, {"t": "progress", "seat": 0, "n": 9})]


@pytest.mark.parametrize("n", [100, True, "5", -1])
def test_impossible_progress_is_flagged_or_ignored(n: Any):
    m = Match()
    at = m.start()
    m.now = at + 1000
    assert m.run("progress", A, "ca", n) == []
    flagged = m.state["match"]["flags"].get(A)  # type: ignore[index]
    assert flagged == ("implausible" if n == 100 or n == -1 else None)


def test_repeated_progress_is_not_relayed():
    m = Match()
    at = m.start()
    m.now = at + 2000
    assert m.run("progress", A, "ca", 5)
    assert m.run("progress", A, "ca", 5) == []


def test_progress_cannot_go_backwards():
    m = Match()
    at = m.start()
    m.now = at + 3000
    m.run("progress", A, "ca", 15)
    m.run("progress", A, "ca", 10)
    assert m.state["match"]["flags"] == {A: "implausible"}  # type: ignore[index]


def run_to_end(m: Match, a: int, b: int, **b_overrides: Any) -> list[Any]:
    at = m.start()
    for sec in range(1, 11):
        m.now = at + sec * 1000
        m.run("progress", A, "ca", a * sec // 10)
        m.run("progress", B, "cb", b * sec // 10)
    m.at_end()
    m.run("final", A, "ca", final_body(a))
    return m.run("final", B, "cb", final_body(b, **b_overrides))


def test_higher_count_wins_and_match_is_recorded():
    m = Match()
    outs = run_to_end(m, 42, 37)
    res = msgs(outs, A, "result")[0]
    assert res["winner"] == 0
    assert [(p["name"], p["strokes"], p["result"], p["status"]) for p in res["players"]] == [
        ("alice", 42, "win", "ok"),
        ("bob", 37, "loss", "ok"),
    ]
    assert msgs(outs, B, "result")[0] == res
    snap = msgs(outs, B, "state")[0]
    assert snap["match"] is None and snap["last"]["round"] == 1
    assert [p["wins"] for p in snap["players"]] == [1, 0]
    rec = m.record
    assert rec and rec["winner"] == A and rec["mode"] == "single"
    assert [p["pid"] for p in rec["players"]] == [A, B]
    assert rec["players"][0]["detail"]["bins"] == final_body(42)["bins"]


def test_equal_counts_draw():
    m = Match()
    res = msgs(run_to_end(m, 30, 30), A, "result")[0]
    assert res["winner"] is None
    assert {p["result"] for p in res["players"]} == {"draw"}
    assert m.record and m.record["winner"] is None


def test_result_that_fails_anticheat_loses():
    m = Match()
    res = msgs(run_to_end(m, 30, 50, fps=2.0), A, "result")[0]
    assert res["winner"] == 0
    assert res["players"][1]["status"] == "rejected"
    assert m.record and m.record["players"][1]["detail"]["reason"] == "implausible"
    assert "reason" not in m.record["players"][0]["detail"]


def test_final_far_above_live_progress_is_rejected():
    m = Match()
    at = m.start()
    m.now = at + 9000
    m.run("progress", B, "cb", 5)  # bob reported 5 strokes, then claims 60
    m.at_end()
    m.run("final", A, "ca", final_body(30))
    res = msgs(m.run("final", B, "cb", final_body(60)), A, "result")[0]
    assert res["players"][1]["status"] == "rejected" and res["winner"] == 0


def test_final_before_time_is_up_is_rejected():
    m = Match()
    at = m.start()
    m.now = at + 5000
    m.run("progress", B, "cb", 20)
    m.run("final", B, "cb", final_body(20))
    assert m.state["match"]["flags"][B] == "too_fast"  # type: ignore[index]


def test_malformed_final_is_rejected_not_crashing():
    m = Match()
    m.start()
    m.at_end()
    m.run("final", A, "ca", {"t": "final", "strokes": "lots"})
    assert m.state["match"]["flags"][A] == "implausible"  # type: ignore[index]
    m.run("final", B, "cb", final_body(10))
    assert m.record and m.record["players"][0]["detail"] == {"reason": "implausible"}


def test_missing_result_forfeits_when_the_alarm_fires():
    m = Match()
    at = m.start()
    m.now = at + 4000
    m.run("progress", B, "cb", 20)
    m.run("leave", B, "cb")  # bob's tab closed mid-match
    m.at_end()
    assert m.run("final", A, "ca", final_body(12)) == []  # waits for bob
    assert m.run("alarm") == []  # too early
    m.now = m.alarm_at  # type: ignore[assignment]
    outs = m.run("alarm")
    res = msgs(outs, A, "result")[0]
    assert res["winner"] == 0
    assert res["players"][1] == {
        "seat": 1,
        "name": "bob",
        "strokes": 20,
        "status": "forfeit",
        "result": "loss",
    }
    assert m.record and m.record["players"][1]["status"] == "forfeit"


def test_rematch_counts_rounds_and_wins():
    m = Match()
    run_to_end(m, 40, 30)
    outs = run_to_end(m, 20, 35)
    snap = msgs(outs, A, "state")[0]
    assert snap["round"] == 2 and [p["wins"] for p in snap["players"]] == [1, 1]
    assert m.record and m.record["id"].endswith("-2")


def test_empty_room_expires_after_idle_time():
    m = Match()
    m.run("leave", A, "ca")
    m.run("leave", B, "cb")
    m.now += rules.ROOM_IDLE_MS
    m.run("alarm")
    assert m.expired


def test_pong_echoes_client_time():
    assert pong(123.5, T0) == {"t": "pong", "c": 123.5, "s": T0}
    assert pong("x", T0) is None
    assert pong(float("nan"), T0) is None


def signal(m: "Match", pid: str, cid: str, data: Any) -> list[Any]:
    return RoomLogic(m.state).signal(pid, cid, data)


def test_media_opt_in_is_shared_and_reset_on_reconnect():
    m = Match()
    outs = m.run("set_media", A, "ca", True, False)
    assert [p["cam"] for p in msgs(outs, B, "state")[0]["players"]] == [True, False]
    assert m.run("set_media", A, "ca", True, False) == []  # no change, nothing sent
    assert m.run("set_media", A, "ca", "yes", False) == []
    assert m.run("set_media", A, "stale", False, False) == []
    m.run("join", ticket(A, "alice"), "ca2")
    assert m.state["players"][0]["cam"] is False  # type: ignore[index]


def test_signals_only_flow_when_both_agree():
    m = Match()
    offer = {"sdp": "v=0...", "type": "offer", "sid": 1}
    assert signal(m, A, "ca", offer) == []  # nobody opted in
    m.run("set_media", A, "ca", True, False)
    m.run("set_media", B, "cb", False, True)
    assert signal(m, A, "ca", offer) == []  # different kinds: no agreement
    m.run("set_media", B, "cb", True, True)
    outs = signal(m, A, "ca", offer)
    assert [(o.to, o.msg) for o in outs] == [(B, {"t": "signal", "d": offer})]
    assert signal(m, A, "ca", "not a dict") == []
    assert signal(m, A, "old-tab", offer) == []
    m.run("leave", B, "cb")
    assert signal(m, A, "ca", offer) == []
