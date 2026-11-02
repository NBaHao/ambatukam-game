"""PvP room logic: two players, a shared clock, live progress and a result.

Free of Workers APIs so plain pytest can drive it. The Durable Object (src/rooms.py) loads the
state, calls one method, then stores `room.state`, sends the returned messages, writes
`room.record` to D1 and sets the alarm to `room.alarm_at`.

The server owns the clock: when both players are ready it picks `at` (GO, server ms) a few seconds
ahead, so both countdowns end together. Results are checked against that clock, against the
live progress each client reported while playing, and with the solo anti-cheat rules.
"""

import math
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from app import rules
from app.schemas import PvpFinal
from app.services import anticheat
from app.services.tickets import Ticket

State = dict[str, Any]


class RoomError(Exception):
    """Joining failed. `code` goes to the client, which shows a message for it."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class Out:
    to: str  # pid of the receiving player
    msg: dict[str, Any]


class RoomLogic:
    def __init__(self, state: State | None) -> None:
        self.state = state
        self.alarm_at: int | None = None
        self.record: dict[str, Any] | None = None
        self.expired = False

    # ---------- helpers ----------
    @property
    def _s(self) -> State:
        assert self.state is not None
        return self.state

    def _player(self, pid: str) -> dict[str, Any] | None:
        if self.state is None:
            return None
        return next((p for p in self._s["players"] if p["pid"] == pid), None)

    def _is_current(self, pid: str, cid: str) -> dict[str, Any] | None:
        """The player, if `cid` is still their live connection (an older tab may linger)."""
        p = self._player(pid)
        return p if p is not None and p["cid"] == cid else None

    def _hands(self) -> int:
        return rules.HANDS[self._s["mode"]]

    def snapshot(self, pid: str) -> dict[str, Any]:
        """What one player sees. Other players' pids stay private: seats only."""
        s = self._s
        match = s["match"]
        return {
            "t": "state",
            "code": s["code"],
            "mode": s["mode"],
            "duration": s["duration"],
            "round": s["round"],
            "you": next(i for i, p in enumerate(s["players"]) if p["pid"] == pid),
            "players": [
                {
                    "seat": i,
                    "name": p["name"],
                    "registered": p["registered"],
                    "ready": p["ready"],
                    "connected": p["connected"],
                    "wins": p["wins"],
                    # Video / voice opt-ins: media only flows for a kind both players turned on
                    "cam": p.get("cam", False),
                    "mic": p.get("mic", False),
                }
                for i, p in enumerate(s["players"])
            ],
            "match": {"round": match["round"], "at": match["at"]} if match else None,
            "last": s["last"],
        }

    def _states(self) -> list[Out]:
        return [Out(p["pid"], self.snapshot(p["pid"])) for p in self._s["players"] if p["connected"]]

    def _idle_alarm(self, now: int) -> None:
        self.alarm_at = now + rules.ROOM_IDLE_MS

    # ---------- events ----------
    def join(self, ticket: Ticket, cid: str, now: int) -> list[Out]:
        if self.state is None:
            if ticket.mode is None or ticket.duration is None:
                raise RoomError("room_not_found")
            self.state = {
                "code": ticket.room,
                "mode": ticket.mode,
                "duration": ticket.duration,
                "created": now,
                "touched": now,
                "round": 0,
                "players": [],
                "match": None,
                "last": None,
            }
        s = self._s
        me = self._player(ticket.pid)
        if me is None:
            if len(s["players"]) >= rules.ROOM_SEATS:
                gone = next((p for p in s["players"] if not p["connected"]), None)
                if gone is None or s["match"] is not None:
                    raise RoomError("room_full")
                # A new opponent takes the empty seat: the score starts over
                s["players"].remove(gone)
                for p in s["players"]:
                    p["wins"] = 0
                s["last"] = None
            me = {"pid": ticket.pid, "wins": 0}
            s["players"].append(me)
        # Media opt-ins start off on every connection; the client sends its choice again
        me.update(
            name=ticket.name,
            registered=ticket.registered,
            cid=cid,
            connected=True,
            ready=False,
            cam=False,
            mic=False,
        )
        s["touched"] = now
        if s["match"] is None:
            self._idle_alarm(now)
        return self._states()

    def set_media(self, pid: str, cid: str, cam: object, mic: object, now: int) -> list[Out]:
        """Opt in / out of sending my camera (cam) or voice (mic) to the opponent."""
        me = self._is_current(pid, cid)
        if me is None or not isinstance(cam, bool) or not isinstance(mic, bool):
            return []
        if me.get("cam") == cam and me.get("mic") == mic:
            return []
        me.update(cam=cam, mic=mic)
        self._s["touched"] = now
        return self._states()

    def signal(self, pid: str, cid: str, data: object) -> list[Out]:
        """WebRTC signaling (offer / answer / ICE candidate), relayed as is to the opponent.

        Only while both players agree on at least one kind of media, so nobody can be sent a
        connection the other side hasn't agreed to.
        """
        me = self._is_current(pid, cid)
        if me is None or not isinstance(data, dict):
            return []
        opp = next((p for p in self._s["players"] if p["pid"] != pid and p["connected"]), None)
        if opp is None or not any(me.get(k) and opp.get(k) for k in ("cam", "mic")):
            return []
        return [Out(opp["pid"], {"t": "signal", "d": data})]

    def leave(self, pid: str, cid: str, now: int) -> list[Out]:
        """The connection closed (tab closed, network lost, or the player left)."""
        me = self._is_current(pid, cid)
        if me is None:
            return []
        me["connected"] = False
        me["ready"] = False
        self._s["touched"] = now
        if self._s["match"] is None:
            self._idle_alarm(now)
        return self._states()

    def set_ready(self, pid: str, cid: str, ready: object, now: int) -> list[Out]:
        """Ready = camera on and hands on the rod(s). Both ready → the match starts."""
        me = self._is_current(pid, cid)
        s = self._s
        if me is None or s["match"] is not None or not isinstance(ready, bool):
            return []
        me["ready"] = ready
        s["touched"] = now
        players = s["players"]
        if len(players) == rules.ROOM_SEATS and all(p["ready"] and p["connected"] for p in players):
            at = now + rules.PVP_START_DELAY_MS
            s["round"] += 1
            s["match"] = {
                "round": s["round"],
                "at": at,
                "deadline": at + s["duration"] * 1000 + rules.PVP_FINAL_GRACE_MS,
                "pids": [p["pid"] for p in players],
                "progress": {},
                "finals": {},
                "flags": {},
            }
            for p in players:
                p["ready"] = False
            self.alarm_at = s["match"]["deadline"]
        return self._states()

    def progress(self, pid: str, cid: str, n: object, now: int) -> list[Out]:
        """Live stroke count, sent a few times a second while playing; relayed to the opponent."""
        m = self._s["match"] if self.state else None
        if self._is_current(pid, cid) is None or m is None or pid not in m["pids"] or pid in m["finals"]:
            return []
        if isinstance(n, bool) or not isinstance(n, int):
            return []
        elapsed = min((now - m["at"]) / 1000, self._s["duration"])
        prev = m["progress"].get(pid, 0)
        # Counted against the server clock: no more strokes than a fast human could have made by now
        cap = rules.MAX_BIN_PER_HAND * self._hands() * (max(0.0, elapsed) + 1)
        if n < prev or n > cap:
            m["flags"].setdefault(pid, "implausible")
            return []
        if n == prev:  # nothing new to relay
            return []
        m["progress"][pid] = n
        seat = m["pids"].index(pid)
        return [Out(p, {"t": "progress", "seat": seat, "n": n}) for p in m["pids"] if p != pid]

    def final(self, pid: str, cid: str, data: object, now: int) -> list[Out]:
        """A player's finished run. Once every player has one, the match ends."""
        m = self._s["match"] if self.state else None
        if self._is_current(pid, cid) is None or m is None or pid not in m["pids"] or pid in m["finals"]:
            return []
        s = self._s
        try:
            run = PvpFinal.model_validate(data)
        except ValidationError:
            run = None
        flag = self._check_final(m, pid, run, now)
        if flag:
            m["flags"].setdefault(pid, flag)
        detail = run and {"bins": run.bins, "fps": run.fps, "grip": run.grip, "split": run.split}
        m["finals"][pid] = {"strokes": run.strokes if run else m["progress"].get(pid, 0), "detail": detail}
        s["touched"] = now
        if all(p in m["finals"] for p in m["pids"]):
            return self._finish(now)
        return []

    def _check_final(self, m: dict[str, Any], pid: str, run: PvpFinal | None, now: int) -> str | None:
        if run is None:
            return "implausible"
        duration = self._s["duration"]
        if now < m["at"] + duration * 1000 - rules.PVP_EARLY_SLACK_MS:
            return "too_fast"
        stats = anticheat.RunStats(bins=run.bins, fps=run.fps, grip=run.grip, split=run.split)
        if anticheat.check_run(self._s["mode"], duration, run.strokes, float(run.strokes), stats) is None:
            return "implausible"
        live = m["progress"].get(pid, 0)
        gap = rules.MAX_BIN_PER_HAND * self._hands() * rules.PVP_PROGRESS_GAP_SEC
        if run.strokes < live or run.strokes - live > gap:
            return "implausible"
        return None

    def alarm(self, now: int) -> list[Out]:
        if self.state is None:
            return []
        m = self._s["match"]
        if m is not None:
            if now >= m["deadline"]:
                return self._finish(now)
            self.alarm_at = m["deadline"]
            return []
        idle = now - self._s["touched"] >= rules.ROOM_IDLE_MS
        if idle and not any(p["connected"] for p in self._s["players"]):
            self.expired = True
            return []
        self._idle_alarm(max(now, self._s["touched"]))
        return []

    def _finish(self, now: int) -> list[Out]:
        """Decide the match. No result in time = forfeit; a rejected result loses."""
        s = self._s
        m = s["match"]
        seats = []
        for pid in m["pids"]:
            fin = m["finals"].get(pid)
            status = "forfeit" if fin is None else ("rejected" if pid in m["flags"] else "ok")
            strokes = fin["strokes"] if fin else m["progress"].get(pid, 0)
            detail = fin and fin["detail"]
            if status == "rejected":  # keep why, for match history
                detail = {**(detail or {}), "reason": m["flags"][pid]}
            seats.append({"pid": pid, "strokes": strokes, "status": status, "detail": detail})
        valid = [x for x in seats if x["status"] == "ok"]
        best = max((x["strokes"] for x in valid), default=None)
        top = [x for x in valid if x["strokes"] == best]
        winner = top[0]["pid"] if len(top) == 1 else None
        for x in seats:
            x["result"] = "draw" if winner is None else ("win" if x["pid"] == winner else "loss")
        if winner is not None:
            self._player(winner)["wins"] += 1  # type: ignore[index]

        names = {p["pid"]: p for p in s["players"]}
        self.record = {
            "id": f"{s['code']}-{s['created']}-{m['round']}",
            "room": s["code"],
            "mode": s["mode"],
            "duration": s["duration"],
            "started_at": m["at"],
            "ended_at": now,
            "winner": winner,
            "players": [
                {
                    "pid": x["pid"],
                    "name": names[x["pid"]]["name"],
                    "registered": names[x["pid"]]["registered"],
                    "strokes": x["strokes"],
                    "result": x["result"],
                    "status": x["status"],
                    "detail": x["detail"],
                }
                for x in seats
            ],
        }
        s["last"] = {
            "round": m["round"],
            "winner": None if winner is None else m["pids"].index(winner),
            "players": [
                {
                    "seat": i,
                    "name": names[x["pid"]]["name"],
                    "strokes": x["strokes"],
                    "status": x["status"],
                    "result": x["result"],
                }
                for i, x in enumerate(seats)
            ],
        }
        s["match"] = None
        s["touched"] = now
        self._idle_alarm(now)
        result = {"t": "result", **s["last"]}
        return [Out(p["pid"], result) for p in s["players"] if p["connected"]] + self._states()


def pong(client_time: object, now: int) -> dict[str, Any] | None:
    """Clock sync: echo the client's timestamp with the server's, so it can work out the offset."""
    if isinstance(client_time, bool) or not isinstance(client_time, int | float):
        return None
    if not math.isfinite(client_time):
        return None
    return {"t": "pong", "c": client_time, "s": now}
