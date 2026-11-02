from typing import Annotated

from fastapi import APIRouter, Depends, Path

from app import clock, rules
from app.dependencies import SessionDep, SettingsDep, UsersDep, get_turn_post, rate_limit
from app.errors import ApiError
from app.schemas import (
    CreateRoomRequest,
    IceRequest,
    IceResponse,
    JoinRoomRequest,
    RoomCode,
    RoomTicketResponse,
)
from app.services import accounts, rtc, tickets

router = APIRouter(tags=["pvp"])


async def _ticket(
    settings: SettingsDep, users: UsersDep, login: SessionDep, code: str, pid: str, name: str, **room: object
) -> RoomTicketResponse:
    # Same identity rules as submitting a score: accounts play under their username,
    # guests can't take a registered name or an account's device id.
    owner_pid, owner_name = await accounts.score_owner(users, login, pid, name)
    ticket = tickets.Ticket(
        room=code,
        pid=owner_pid,
        name=owner_name,
        registered=login is not None,
        expires_ms=clock.now_ms() + rules.ROOM_TICKET_SEC * 1000,
        **room,  # type: ignore[arg-type]
    )
    return RoomTicketResponse(code=code, ticket=tickets.issue(settings.token_secret, ticket))


@router.post("/rooms", dependencies=[Depends(rate_limit("ROOM_LIMIT"))])
async def create_room(
    body: CreateRoomRequest, settings: SettingsDep, users: UsersDep, login: SessionDep
) -> RoomTicketResponse:
    """Create a PvP challenge room. Share `/c/{code}`; the room opens when its creator connects."""
    code = tickets.new_room_code()
    return await _ticket(
        settings, users, login, code, body.pid, body.name, mode=body.mode, duration=body.duration
    )


@router.post("/rooms/{code}/join", dependencies=[Depends(rate_limit("SESSION_LIMIT"))])
async def join_room(
    code: Annotated[RoomCode, Path()],
    body: JoinRoomRequest,
    settings: SettingsDep,
    users: UsersDep,
    login: SessionDep,
) -> RoomTicketResponse:
    """A ticket to join an existing room (the socket reports `room_not_found` if there is none)."""
    return await _ticket(settings, users, login, code, body.pid, body.name)


@router.post("/rooms/{code}/ice", dependencies=[Depends(rate_limit("SESSION_LIMIT"))])
async def ice_servers(
    code: Annotated[RoomCode, Path()],
    body: IceRequest,
    settings: SettingsDep,
    post_json: Annotated[rtc.PostJson, Depends(get_turn_post)],
) -> IceResponse:
    """ICE servers for video / voice with the opponent (players in this room only).

    503 `rtc_unavailable` when TURN isn't configured: the client hides the camera / mic toggles.
    """
    if tickets.verify(settings.token_secret, body.ticket, code, clock.now_ms()) is None:
        raise ApiError("bad_ticket", 403)
    cfg = rtc.RtcConfig(settings.turn_key_id, settings.turn_api_token, settings.rtc_allow_direct)
    return IceResponse(**await rtc.ice_servers(cfg, post_json))
