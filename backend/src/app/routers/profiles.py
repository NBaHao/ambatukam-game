from fastapi import APIRouter, Depends

from app.dependencies import FriendsDep, ProfilesDep, SessionDep, UsersDep, rate_limit
from app.schemas import ProfileResponse, Username
from app.services import profiles

router = APIRouter(tags=["profiles"])


@router.get("/users/{username}", dependencies=[Depends(rate_limit("SESSION_LIMIT"))])
async def get_profile(
    username: Username, users: UsersDep, repo: ProfilesDep, friends: FriendsDep, login: SessionDep
) -> ProfileResponse:
    """Public profile of an account: best score per mode with its rank, PvP totals, latest matches.
    For a logged-in viewer, also how they relate (friends, request sent…)."""
    return ProfileResponse(**await profiles.profile(users, repo, username, friends, login and login.user))
