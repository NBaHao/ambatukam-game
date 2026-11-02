"""Cloudflare Worker entrypoint.

/api/rooms/{code}/ws (PvP room sockets) goes to that room's Durable Object, /api/lobby/ws (presence,
invites) to the one Lobby object; every other /api/* request goes to the FastAPI app through ASGI.
"""

import re
from urllib.parse import urlsplit

from workers import WorkerEntrypoint

from app.main import app
from app.services.tickets import ROOM_CODE_RE
from lobby_room import Lobby
from pvp_room import PvpRoom

__all__ = ["Default", "Lobby", "PvpRoom"]

_ROOM_SOCKET = re.compile(r"^/api/rooms/([^/]+)/ws$")


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        path = urlsplit(request.url).path
        if path == "/api/lobby/ws":
            return await self.env.LOBBY.getByName("global").fetch(request.js_object)
        m = _ROOM_SOCKET.match(path)
        if m and ROOM_CODE_RE.match(m[1]):
            stub = self.env.PVP_ROOM.getByName(m[1])
            return await stub.fetch(request.js_object)

        import asgi  # chỉ có trong runtime Python Workers

        return await asgi.fetch(app, request, self.env)
