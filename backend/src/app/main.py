"""Ứng dụng FastAPI.

  POST /api/session      { mode, duration }                    → { token }
  POST /api/score        { token, captcha, pid, name, strokes,
                           survived?, bins, fps, grip, split? }  → { name, score, strokes, rank, total }
  GET  /api/leaderboard  ?mode=&duration=&pid=                  → { entries, me }

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
