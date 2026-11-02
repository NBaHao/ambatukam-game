"""Ứng dụng FastAPI.

  POST /api/session      { mode, duration }                    → { token }
  POST /api/score        { token, captcha, pid, name, strokes,
                           survived?, bins, fps, grip, split? }  → { name, score, strokes, rank, total }
  GET  /api/leaderboard  ?mode=&duration=&pid=                  → { entries, me }

  GET  /api/users/{username}/exists                             → { exists }
  POST /api/auth/register { username, password, email?, pid, captcha } → { user }  (sets amb_sid cookie)
  POST /api/auth/login    { username, password }                → { user }  (sets amb_sid cookie)
  POST /api/auth/logout                                         → { user: null }
  GET  /api/me                                                  → { user | null }
  PUT  /api/me/email      { email | null, password }            → { user }
  GET  /api/auth/reset                                          → { available }  (false: no email service)
  POST /api/auth/reset/request { username, captcha, lang }      → { available }  (emails a link, if any)
  POST /api/auth/reset    { token, password }                   → { user }  (sets amb_sid, other sessions end)
  GET  /api/users/{username}   → { username, joined_at, records, pvp, matches, relation }  (public profile)

  POST /api/rooms              { mode, duration, pid, name }    → { code, ticket }
  POST /api/rooms/{code}/join  { pid, name }                    → { code, ticket }
  GET  /api/rooms/{code}/ws?ticket=   WebSocket, handled by the PvpRoom Durable Object (src/entry.py)
  POST /api/rooms/{code}/ice   { ticket }                       → { ice_servers, relay }  (503 if no TURN)

  GET    /api/friends                                           → { friends, incoming, outgoing }
  POST   /api/friends/{username}                                → { relation }  (request or accept)
  DELETE /api/friends/{username}                                → { relation: "none" }
  POST   /api/lobby          { pid, name }                      → { ticket, name }
  GET    /api/lobby/ws?ticket=        WebSocket, the Lobby Durable Object: presence, invites, matchmaking

Tài liệu OpenAPI: /api/docs. Game và API cùng tên miền nên không cần CORS
(chạy local thì Vite proxy /api sang Worker).
"""

from fastapi import FastAPI

from app.errors import register_error_handlers
from app.routers import api_router


def create_app() -> FastAPI:
    app = FastAPI(
        title="Ambatukam API",
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.include_router(api_router)
    register_error_handlers(app)
    return app


app = create_app()
