from fastapi import APIRouter, Depends

from app import clock
from app.dependencies import FriendsDep, LoginDep, UsersDep, rate_limit
from app.schemas import FriendActionResponse, FriendsResponse, Username
from app.services import friends

router = APIRouter(tags=["friends"])

_limit = [Depends(rate_limit("SESSION_LIMIT"))]


@router.get("/friends")
async def list_friends(login: LoginDep, repo: FriendsDep) -> FriendsResponse:
    """My friends and pending requests (who is online comes from the lobby socket)."""
    return FriendsResponse(**await friends.listing(repo, login.user))


@router.post("/friends/{username}", dependencies=_limit)
async def add_friend(
    username: Username, login: LoginDep, users: UsersDep, repo: FriendsDep
) -> FriendActionResponse:
    """Send a friend request, or accept theirs."""
    rel = await friends.add(users, repo, login.user, username, clock.now_ms())
    return FriendActionResponse(relation=rel)  # type: ignore[arg-type]


@router.delete("/friends/{username}", dependencies=_limit)
async def remove_friend(
    username: Username, login: LoginDep, users: UsersDep, repo: FriendsDep
) -> FriendActionResponse:
    """Unfriend, cancel a request or decline one."""
    await friends.remove(users, repo, login.user, username)
    return FriendActionResponse(relation="none")
