"""PvP room Durable Object: one instance per room code, players connect over WebSockets.

Uses the WebSocket Hibernation API: the object can be evicted from memory between messages, so
the room state lives in DO storage (one JSON value) and each socket carries a small attachment
(pid + connection id). All game rules are in app/services/room.py; this file only does I/O.

Client → server: {"t": "ping", "c": ms} | {"t": "ready", "v": bool} | {"t": "progress", "n": int}
                 | {"t": "final", ...PvpFinal}
Server → client: {"t": "state", ...} | {"t": "progress", "seat", "n"} | {"t": "result", ...}
                 | {"t": "pong", "c", "s"} | {"t": "error", "code"}
"""

import contextlib
import json
import secrets
from typing import Any
from urllib.parse import parse_qs, urlsplit

from js import Response, WebSocketPair
from workers import DurableObject

from app import clock
from app.config import Settings
from app.db import MatchRepository
from app.services import room as logic
from app.services import tickets

MAX_MESSAGE = 4096
# Live counts arrive 4 times a second per player: keep them in memory and write them to storage at most this
# often (the object stays in memory while messages flow; storage writes count against the quota)
PROGRESS_SAVE_MS = 2000
CLOSE_REJECTED = 4000  # join refused: the reason is in the preceding {"t": "error"} message
CLOSE_REPLACED = 4001  # the same player connected again (another tab / reconnect)


class PvpRoom(DurableObject):
    def __init__(self, ctx: Any, env: Any) -> None:
        super().__init__(ctx, env)
        self._state: dict[str, Any] | None = None
        self._loaded = False
        self._saved_at = 0

    async def _room(self) -> logic.RoomLogic:
        if not self._loaded:
            raw = await self.ctx.storage.get("state")
            self._state = json.loads(raw) if raw else None
            self._loaded = True
        return logic.RoomLogic(self._state)

    async def _commit(self, room: logic.RoomLogic, outs: list[logic.Out], *, lazy: bool = False) -> None:
        if room.expired:
            await self.ctx.storage.deleteAll()
            self._state = None
            return
        self._state = room.state
        now = clock.now_ms()
        if room.state is not None and not (lazy and now - self._saved_at < PROGRESS_SAVE_MS):
            await self.ctx.storage.put("state", json.dumps(room.state))
            self._saved_at = now
        if room.record is not None:
            try:
                await MatchRepository(self.env.DB).record(room.record)
            except Exception as exc:  # the result still reaches the players
                print(f"pvp: could not record match {room.record['id']}: {exc!r}")
        if room.alarm_at is not None:
            await self.ctx.storage.setAlarm(room.alarm_at)
        self._send(outs)

    def _sockets(self) -> list[tuple[Any, dict[str, Any]]]:
        out = []
        for ws in self.ctx.getWebSockets():
            raw = ws.deserializeAttachment()
            if raw:
                out.append((ws, json.loads(raw)))
        return out

    def _send(self, outs: list[logic.Out]) -> None:
        if not outs:
            return
        by_pid: dict[str, list[Any]] = {}
        for ws, att in self._sockets():
            by_pid.setdefault(att["pid"], []).append(ws)
        for o in outs:
            data = json.dumps(o.msg)
            for ws in by_pid.get(o.to, []):
                _try_send(ws, data)

    async def fetch(self, request: Any) -> Any:
        if request.headers.get("Upgrade") != "websocket":
            return Response.new("expected websocket", status=426)
        url = urlsplit(request.url)
        code = url.path.rstrip("/").split("/")[-2]
        token = parse_qs(url.query).get("ticket", [""])[0]
        now = clock.now_ms()
        ticket = tickets.verify(Settings.from_env(self.env).token_secret, token, code, now)

        if ticket is None:
            return _reject("bad_ticket")
        room = await self._room()
        cid = secrets.token_urlsafe(8)
        try:
            outs = room.join(ticket, cid, now)
        except logic.RoomError as err:
            return _reject(err.code)
        client, server = WebSocketPair.new().object_values()
        self.ctx.acceptWebSocket(server)
        # Older sockets of the same player (another tab, a dropped connection) are closed
        for ws, att in self._sockets():
            if att["pid"] == ticket.pid:
                _try_send(ws, json.dumps({"t": "error", "code": "replaced"}))
                _try_close(ws, CLOSE_REPLACED, "replaced")
        server.serializeAttachment(json.dumps({"pid": ticket.pid, "cid": cid}))
        await self._commit(room, outs)
        return Response.new(None, status=101, webSocket=client)

    async def webSocketMessage(self, ws: Any, message: Any) -> None:
        raw = ws.deserializeAttachment()
        if not raw or not isinstance(message, str) or len(message) > MAX_MESSAGE:
            return
        att = json.loads(raw)
        try:
            msg = json.loads(message)
        except ValueError:
            return
        if not isinstance(msg, dict):
            return
        now = clock.now_ms()
        kind = msg.get("t")
        if kind == "ping":
            pong = logic.pong(msg.get("c"), now)
            if pong:
                _try_send(ws, json.dumps(pong))
            return
        room = await self._room()
        if room.state is None:
            return
        pid, cid = att["pid"], att["cid"]
        if kind == "progress":
            flags = len((room.state.get("match") or {}).get("flags", {}))
            outs = room.progress(pid, cid, msg.get("n"), now)
            flagged = len((room.state.get("match") or {}).get("flags", {})) != flags
            await self._commit(room, outs, lazy=not flagged)
            return
        if kind == "ready":
            outs = room.set_ready(pid, cid, msg.get("v"), now)
        elif kind == "final":
            outs = room.final(pid, cid, msg, now)
        else:
            return
        await self._commit(room, outs)

    async def webSocketClose(self, ws: Any, code: int, reason: str, was_clean: bool) -> None:
        await self._closed(ws)
        _try_close(ws, 1000, "bye")

    async def webSocketError(self, ws: Any, error: Any) -> None:
        await self._closed(ws)

    async def _closed(self, ws: Any) -> None:
        raw = ws.deserializeAttachment()
        if not raw:
            return
        att = json.loads(raw)
        room = await self._room()
        if room.state is None:
            return
        outs = room.leave(att["pid"], att["cid"], clock.now_ms())
        await self._commit(room, outs)

    async def alarm(self, *_args: Any) -> None:
        room = await self._room()
        outs = room.alarm(clock.now_ms())
        await self._commit(room, outs)


def _reject(code: str) -> Any:
    """Refuse a join. Browsers can't read an HTTP error on a WebSocket upgrade, so accept a plain
    (non-hibernating) socket, send the reason and close it."""
    client, server = WebSocketPair.new().object_values()
    server.accept()
    _try_send(server, json.dumps({"t": "error", "code": code}))
    _try_close(server, CLOSE_REJECTED, code)
    return Response.new(None, status=101, webSocket=client)


def _try_send(ws: Any, data: str) -> None:
    with contextlib.suppress(Exception):  # the socket closed in the meantime
        ws.send(data)


def _try_close(ws: Any, code: int, reason: str) -> None:
    with contextlib.suppress(Exception):
        ws.close(code, reason)
