"""Public profile of an account: best scores, PvP record and recent matches.

Only registered usernames have a profile; guests (just a device id) don't. Nothing private is
exposed: no player ids, email or sign-in data, only what the leaderboard and PvP rooms already show.
"""

from typing import Any

from app import rules
from app.db import FriendRepository, ProfileRepository, UserRepository
from app.errors import ApiError
from app.services import friends as friendship

_MODE_ORDER = {"single": 0, "double": 1, "random": 2}


async def profile(
    users: UserRepository,
    profiles: ProfileRepository,
    username: str,
    friends: FriendRepository | None = None,
    viewer: dict[str, Any] | None = None,
) -> dict[str, Any]:
    user = await users.by_username(username)
    if user is None:
        raise ApiError("user_not_found", 404)
    stats = await profiles.stats(user["pid"], rules.PVP_HISTORY_N)
    relation = await friendship.relation(friends, viewer, user) if friends and viewer else None
    records = sorted(stats["records"], key=lambda r: (_MODE_ORDER.get(r["mode"], 9), r["duration"]))
    return {
        "username": user["username"],
        "joined_at": user["created_at"],
        "records": records,
        "pvp": stats["pvp"],
        "matches": [_match(m) for m in stats["matches"]],
        "relation": relation,
    }


def _match(m: dict[str, Any]) -> dict[str, Any]:
    opponent = None
    if m["opp_name"] is not None:
        opponent = {
            "name": m["opp_name"],
            "username": m["opp_username"],
            "strokes": m["opp_strokes"],
            "status": m["opp_status"],
        }
    keys = ("id", "mode", "duration", "ended_at", "result", "status", "strokes")
    return {**{k: m[k] for k in keys}, "opponent": opponent}
