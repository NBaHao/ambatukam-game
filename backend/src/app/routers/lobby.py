from fastapi import APIRouter, Depends

from app import clock, rules
from app.dependencies import SessionDep, SettingsDep, UsersDep, rate_limit
from app.schemas import LobbyRequest, LobbyTicketResponse
from app.services import accounts, tickets

router = APIRouter(tags=["pvp"])


@router.post("/lobby", dependencies=[Depends(rate_limit("SESSION_LIMIT"))])
async def lobby_ticket(
    body: LobbyRequest, settings: SettingsDep, users: UsersDep, login: SessionDep
) -> LobbyTicketResponse:
    """A ticket for the lobby socket (`/api/lobby/ws`): friends' presence and PvP invites."""
    pid, name = await accounts.score_owner(users, login, body.pid, body.name)
    ticket = tickets.Ticket(
        room=tickets.LOBBY,
        pid=pid,
        name=name,
        registered=login is not None,
        expires_ms=clock.now_ms() + rules.LOBBY_TICKET_SEC * 1000,
    )
    return LobbyTicketResponse(ticket=tickets.issue(settings.token_secret, ticket), name=name)
