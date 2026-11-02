"""Cloudflare Worker entrypoint.

/api/rooms/{code}/ws (PvP room sockets) goes to that room's Durable Object, /api/lobby/ws (presence,
invites) to the one Lobby object; every other /api/* request goes to the FastAPI app through ASGI.
/c/{code} (PvP invite links) is the app's index.html with the invite's link preview tags.
"""

import json
import re
from typing import Any
from urllib.parse import parse_qs, urlsplit

from js import Headers, Request, Response
from workers import WorkerEntrypoint

from app.config import Settings
from app.main import app
from app.services import invite_preview
from app.services.tickets import ROOM_CODE_RE
from lobby_room import Lobby
from pvp_room import PvpRoom

__all__ = ["Default", "Lobby", "PvpRoom"]

_ROOM_SOCKET = re.compile(r"^/api/rooms/([^/]+)/ws$")
_INVITE = re.compile(r"^/c/([^/]+)/?$")


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        path = urlsplit(request.url).path
        if path == "/api/lobby/ws":
            return await self.env.LOBBY.getByName("global").fetch(request.js_object)
        m = _ROOM_SOCKET.match(path)
        if m and ROOM_CODE_RE.match(m[1]):
            stub = self.env.PVP_ROOM.getByName(m[1])
            return await stub.fetch(request.js_object)
        m = _INVITE.match(path)
        if m:
            return await self._invite(request, m[1])

        import asgi  # chỉ có trong runtime Python Workers

        return await asgi.fetch(app, request, self.env)

    async def _invite(self, request: Any, code: str) -> Any:
        """The app page for an invite link, with a preview naming the host (crawlers don't run the app)."""
        page = await self.env.ASSETS.fetch(request.js_object)
        if not ROOM_CODE_RE.match(code) or page.status != 200:
            return page
        room = None
        try:
            res = await self.env.PVP_ROOM.getByName(code).fetch(Request.new("https://room/preview"))
            room = json.loads(await res.text())
        except Exception as exc:  # no host name then, the generic invite preview still works
            print(f"invite: no preview for room {code}: {exc!r}")
        html = await page.text()
        lang = parse_qs(urlsplit(request.url).query).get("lang", [None])[0]
        try:
            origin = Settings.from_env(self.env).app_origin  # absolute https URLs, as crawlers want
            html = invite_preview.render(
                html,
                invite_preview.preview_for(room, lang),
                url=f"{origin}/c/{code}" + ("?lang=vi" if lang == "vi" else ""),
                image=f"{origin}/og-invite.png",
            )
        except Exception as exc:  # the page must still load: keep the site's own preview
            print(f"invite: could not write the preview for room {code}: {exc!r}")
        headers = Headers.new()
        headers.set("content-type", "text/html; charset=utf-8")
        headers.set("cache-control", "no-cache")  # the host's name changes with the room
        return Response.new(html, status=200, headers=headers)
