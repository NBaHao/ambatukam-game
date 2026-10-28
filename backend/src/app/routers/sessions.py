from fastapi import APIRouter, Depends

from app import clock
from app.dependencies import SettingsDep, rate_limit
from app.schemas import SessionRequest, SessionResponse
from app.services import tokens

router = APIRouter(tags=["sessions"])


@router.post("/session", dependencies=[Depends(rate_limit("SESSION_LIMIT"))])
async def create_session(body: SessionRequest, settings: SettingsDep) -> SessionResponse:
    """Client gọi lúc bắt đầu ván. Token ghi lại lúc bắt đầu để khi nộp điểm đối chiếu thời lượng."""
    session = tokens.new_session(body.mode, body.duration, clock.now_ms())
    return SessionResponse(token=tokens.sign(settings.token_secret, session))
