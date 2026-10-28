"""Cloudflare Worker entrypoint: chuyển mọi request /api/* cho ứng dụng FastAPI qua ASGI."""

from workers import WorkerEntrypoint

from app.main import app


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        import asgi  # chỉ có trong runtime Python Workers

        return await asgi.fetch(app, request, self.env)
