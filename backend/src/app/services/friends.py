"""Friends between accounts: send a request, the other side accepts (or sends one back), either removes."""

from typing import Any, Literal

from app import rules
from app.db import FriendRepository, UserRepository
from app.errors import ApiError

Relation = Literal["self", "friends", "outgoing", "incoming", "none"]


def _relation(me_id: str, rows: list[dict[str, Any]]) -> Relation:
    if any(r["accepted_at"] is not None for r in rows):
        return "friends"
    # Both may have sent a request at once: theirs wins, so adding back accepts it
    if any(r["requester_id"] != me_id for r in rows):
        return "incoming"
    return "outgoing" if rows else "none"


async def relation(friends: FriendRepository, me: dict[str, Any], other: dict[str, Any]) -> Relation:
    if me["id"] == other["id"]:
        return "self"
    return _relation(me["id"], await friends.between(me["id"], other["id"]))


async def _other(users: UserRepository, me: dict[str, Any], username: str) -> dict[str, Any]:
    other = await users.by_username(username)
    if other is None:
        raise ApiError("user_not_found", 404)
    if other["id"] == me["id"]:
        raise ApiError("cannot_friend_self")
    return other


async def add(
    users: UserRepository, friends: FriendRepository, me: dict[str, Any], username: str, now: int
) -> Relation:
    """Send a friend request, or accept theirs if they already sent one. Returns the new relation."""
    other = await _other(users, me, username)
    current = _relation(me["id"], await friends.between(me["id"], other["id"]))
    if current in ("friends", "outgoing"):
        return current
    counts = await friends.counts(me["id"])
    if counts["friends"] >= rules.MAX_FRIENDS:
        raise ApiError("too_many_friends", 409)
    if current == "incoming":
        await friends.accept(other["id"], me["id"], now)
        return "friends"
    if counts["outgoing"] >= rules.MAX_FRIEND_REQUESTS:
        raise ApiError("too_many_requests", 409)
    await friends.create(me["id"], other["id"], now)
    return "outgoing"


async def remove(users: UserRepository, friends: FriendRepository, me: dict[str, Any], username: str) -> None:
    """Unfriend, cancel my request or decline theirs."""
    other = await _other(users, me, username)
    await friends.delete(me["id"], other["id"])


async def listing(friends: FriendRepository, me: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Friends (A to Z), requests to me and requests I sent (newest first)."""
    rows = await friends.rows(me["id"])
    accepted = {r["username"]: r["accepted_at"] for r in rows if r["accepted_at"] is not None}
    pending = [r for r in rows if r["accepted_at"] is None and r["username"] not in accepted]
    by_new = sorted(pending, key=lambda r: -r["created_at"])
    incoming = [r for r in by_new if not r["outgoing"]]
    asked_me = {r["username"] for r in incoming}  # crossing requests: show theirs only
    outgoing = [r for r in by_new if r["outgoing"] and r["username"] not in asked_me]
    return {
        "friends": [{"username": u, "since": at} for u, at in sorted(accepted.items())],
        "incoming": [{"username": r["username"], "at": r["created_at"]} for r in incoming],
        "outgoing": [{"username": r["username"], "at": r["created_at"]} for r in outgoing],
    }
