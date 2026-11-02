from fastapi import APIRouter

from app.routers import auth, friends, leaderboard, lobby, profiles, rooms, scores, sessions

api_router = APIRouter(prefix="/api")
api_router.include_router(sessions.router)
api_router.include_router(scores.router)
api_router.include_router(leaderboard.router)
api_router.include_router(auth.router)
api_router.include_router(rooms.router)
api_router.include_router(profiles.router)
api_router.include_router(friends.router)
api_router.include_router(lobby.router)
