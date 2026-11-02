"""Cloudflare Worker entrypoint.

/api/rooms/{code}/ws (PvP room sockets) goes to that room's Durable Object; every other /api/*
request goes to the FastAPI app through ASGI.
"""

import re
from urllib.parse import urlsplit

from workers import WorkerEntrypoint

from app.main import app
from app.services.tickets import ROOM_CODE_RE
from pvp_room import PvpRoom

__all__ = ["Default", "PvpRoom"]

_ROOM_SOCKET = re.compile(r"^/api/rooms/([^/]+)/ws$")


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        m = _ROOM_SOCKET.match(urlsplit(request.url).path)
        if m and ROOM_CODE_RE.match(m[1]):
            stub = self.env.PVP_ROOM.getByName(m[1])
            return await stub.fetch(request.js_object)

        import asgi  # chỉ có trong runtime Python Workers

        return await asgi.fetch(app, request, self.env)
