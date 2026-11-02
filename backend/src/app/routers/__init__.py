from fastapi import APIRouter

from app.routers import auth, leaderboard, rooms, scores, sessions

api_router = APIRouter(prefix="/api")
api_router.include_router(sessions.router)
api_router.include_router(scores.router)
api_router.include_router(leaderboard.router)
api_router.include_router(auth.router)
api_router.include_router(rooms.router)
