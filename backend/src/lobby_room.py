"""Lobby Durable Object: one global instance; every logged-in tab keeps a socket open to it.

Presence: an account is online while it has at least one socket here. Only its friends are told
(friend lists come from D1 when needed, so nothing is cached that could go stale). It also relays
PvP invites between friends. Sockets use the Hibernation API; each carries its player in an
attachment, so the object keeps no state of its own. Message rules are in app/services/lobby.py.
"""

import contextlib
import json
import secrets
from typing import Any
from urllib.parse import parse_qs, urlsplit

from js import Response, WebSocketPair, WebSocketRequestResponsePair
from workers import DurableObject

from app import clock, rules
from app.config import Settings
from app.db import FriendRepository
from app.services import lobby, tickets
from app.services.room import pong

MAX_MESSAGE = 1024
# Keep-alive answered by the runtime without waking the object (no request billed)
HEARTBEAT = '{"t":"hb"}'
CLOSE_REJECTED = 4000


class Lobby(DurableObject):
    def __init__(self, ctx: Any, env: Any) -> None:
        super().__init__(ctx, env)
        self._invites = lobby.Throttle(rules.LOBBY_INVITE_GAP_MS)
        self._nudges = lobby.Throttle(rules.LOBBY_INVITE_GAP_MS)
        self._queues = lobby.Throttle(rules.LOBBY_QUEUE_GAP_MS)
        ctx.setWebSocketAutoResponse(WebSocketRequestResponsePair.new(HEARTBEAT, HEARTBEAT))

    # ---------- sockets ----------
    def _sockets(self) -> list[tuple[Any, dict[str, Any]]]:
        out = []
        for ws in self.ctx.getWebSockets():
            raw = ws.deserializeAttachment()
            if raw:
                out.append((ws, json.loads(raw)))
        return out

    def _of(self, name: str, *, besides: str | None = None) -> list[Any]:
        """Open sockets of an account (optionally not counting connection `besides`)."""
        return [ws for ws, a in self._sockets() if a["reg"] and a["name"] == name and a["cid"] != besides]

    def _online(self) -> set[str]:
        return {a["name"] for _, a in self._sockets() if a["reg"]}

    def _tell(self, names: list[str], msg: dict[str, Any]) -> None:
        data = json.dumps(msg)
        wanted = set(names)
        for ws, a in self._sockets():
            if a["reg"] and a["name"] in wanted:
                _try_send(ws, data)

    async def _friends(self, name: str) -> list[str]:
        try:
            return await FriendRepository(self.env.DB).friend_names(name)
        except Exception as exc:  # presence is best effort
            print(f"lobby: friend list failed: {exc!r}")
            return []

    async def _hello(self, ws: Any, att: dict[str, Any]) -> None:
        online = sorted(set(await self._friends(att["name"])) & self._online()) if att["reg"] else []
        _try_send(ws, json.dumps({"t": "hello", "name": att["name"], "online": online}))

    async def _announce(self, name: str, on: bool) -> None:
        friends = set(await self._friends(name)) & self._online()
        self._tell(sorted(friends), {"t": "online", "user": name, "on": on})

    # ---------- handlers ----------
    async def fetch(self, request: Any) -> Any:
        if request.headers.get("Upgrade") != "websocket":
            return Response.new("expected websocket", status=426)
        token = parse_qs(urlsplit(request.url).query).get("ticket", [""])[0]
        secret = Settings.from_env(self.env).token_secret
        ticket = tickets.verify(secret, token, tickets.LOBBY, clock.now_ms())
        if ticket is None:
            return _reject("bad_ticket")
        client, server = WebSocketPair.new().object_values()
        self.ctx.acceptWebSocket(server)
        cid = secrets.token_urlsafe(8)
        att = {"pid": ticket.pid, "name": ticket.name, "reg": ticket.registered, "cid": cid}
        first = ticket.registered and not self._of(ticket.name)
        server.serializeAttachment(json.dumps(att))
        await self._hello(server, att)
        if first:
            await self._announce(ticket.name, True)
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
        kind, now = msg.get("t"), clock.now_ms()
        if kind == "ping":
            p = pong(msg.get("c"), now)
            if p:
                _try_send(ws, json.dumps(p))
        elif kind == "sync":
            await self._hello(ws, att)
        elif kind == "queue":
            self._queue(ws, att, msg, now)
        elif kind == "unqueue":
            att.pop("q", None)
            ws.serializeAttachment(json.dumps(att))
        elif not att["reg"]:
            _error(ws, "login_required")
        elif kind == "invite":
            await self._invite(ws, att, msg, now)
        elif kind == "decline":
            to, code = lobby.target(msg), lobby.room_code(msg)
            if to and code and await self._link(att["name"], to) == "friends":
                self._tell([to], {"t": "declined", "by": att["name"], "code": code})
        elif kind == "nudge":
            # After a friend request / accept / removal: the other side refreshes its friend list
            to = lobby.target(msg)
            if to and self._nudges.allow(f"{att['name']}>{to}", now) and to in self._online():
                self._tell([to], {"t": "friends_changed"})

    async def _invite(self, ws: Any, att: dict[str, Any], msg: dict[str, Any], now: int) -> None:
        inv = lobby.invite(msg)
        if inv is None:
            return _error(ws, "bad_invite")
        if not self._invites.allow(att["name"], now):
            return _error(ws, "slow_down")
        if inv["to"] not in self._online():
            return _error(ws, "not_online")
        if await self._link(att["name"], inv["to"]) != "friends":
            return _error(ws, "not_friends")
        out = {"t": "invite", "from": att["name"], "code": inv["code"], "mode": inv["mode"]}
        self._tell([inv["to"]], {**out, "duration": inv["duration"]})
        _try_send(ws, json.dumps({"t": "invited", "to": inv["to"], "code": inv["code"]}))

    def _queue(self, ws: Any, att: dict[str, Any], msg: dict[str, Any], now: int) -> None:
        board = lobby.queue_board(msg)
        if board is None:
            return _error(ws, "bad_queue")
        if not self._queues.allow(att["cid"], now):
            return _error(ws, "slow_down")
        att["q"] = {"m": board[0], "d": board[1], "at": now}
        others = [(w, a) for w, a in self._sockets() if a["cid"] != att["cid"]]
        opp = lobby.pick_opponent(att, [a for _, a in others])
        if opp is None:
            ws.serializeAttachment(json.dumps(att))
            _try_send(ws, json.dumps({"t": "queued", "mode": board[0], "duration": board[1]}))
            return
        opp_ws = next(w for w, a in others if a["cid"] == opp["cid"])
        att.pop("q")
        opp.pop("q")
        ws.serializeAttachment(json.dumps(att))
        opp_ws.serializeAttachment(json.dumps(opp))
        code = tickets.new_room_code()
        secret = Settings.from_env(self.env).token_secret
        for me, them, sock in ((att, opp, ws), (opp, att, opp_ws)):
            ticket = tickets.Ticket(
                room=code,
                pid=me["pid"],
                name=me["name"],
                registered=me["reg"],
                expires_ms=now + rules.ROOM_TICKET_SEC * 1000,
                mode=board[0],
                duration=board[1],
            )
            out = {"t": "matched", "code": code, "ticket": tickets.issue(secret, ticket)}
            opponent = {"name": them["name"], "registered": them["reg"]}
            _try_send(sock, json.dumps({**out, "mode": board[0], "duration": board[1], "opponent": opponent}))

    async def _link(self, a: str, b: str) -> str | None:
        try:
            return await FriendRepository(self.env.DB).link(a, b)
        except Exception as exc:
            print(f"lobby: friend check failed: {exc!r}")
            return None

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
        if att["reg"] and not self._of(att["name"], besides=att["cid"]):
            await self._announce(att["name"], False)


def _error(ws: Any, code: str) -> None:
    _try_send(ws, json.dumps({"t": "error", "code": code}))


def _reject(code: str) -> Any:
    client, server = WebSocketPair.new().object_values()
    server.accept()
    _try_send(server, json.dumps({"t": "error", "code": code}))
    _try_close(server, CLOSE_REJECTED, code)
    return Response.new(None, status=101, webSocket=client)


def _try_send(ws: Any, data: str) -> None:
    with contextlib.suppress(Exception):
        ws.send(data)


def _try_close(ws: Any, code: int, reason: str) -> None:
    with contextlib.suppress(Exception):
        ws.close(code, reason)
