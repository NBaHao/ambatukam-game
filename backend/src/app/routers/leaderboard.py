from typing import Annotated

from fastapi import APIRouter, Query

from app.dependencies import RepositoryDep
from app.errors import ApiError
from app.rules import Mode, is_valid_duration
from app.schemas import LeaderboardResponse

router = APIRouter(tags=["leaderboard"])


@router.get("/leaderboard")
async def get_leaderboard(
    repo: RepositoryDep,
    mode: Mode,
    duration: int,
    pid: Annotated[str | None, Query(pattern=r"^[A-Za-z0-9-]{8,64}$")] = None,
) -> LeaderboardResponse:
    """Top người chơi của một chế độ + mốc thời gian, kèm hạng của `pid` nếu có."""
    if not is_valid_duration(mode, duration):
        raise ApiError("bad_mode")
    return LeaderboardResponse(**await repo.leaderboard(mode, duration, pid))
