from fastapi import APIRouter, Depends

from app import clock, rules
from app.dependencies import HumanVerifierDep, RepositoryDep, SettingsDep, rate_limit
from app.errors import ApiError
from app.schemas import RankResponse, ScoreRequest
from app.services import anticheat, tokens

router = APIRouter(tags=["scores"])


@router.post("/score", dependencies=[Depends(rate_limit("SCORE_LIMIT"))])
async def submit_score(
    body: ScoreRequest,
    settings: SettingsDep,
    repo: RepositoryDep,
    verify_human: HumanVerifierDep,
) -> RankResponse:
    """Nộp điểm của một ván (hoặc nộp lại cùng ván để đổi tên). Trả về hạng hiện tại."""
    session = tokens.verify(settings.token_secret, body.token)
    if session is None:
        raise ApiError("bad_token")
    now = clock.now_ms()
    elapsed = (now - session.started_ms) / 1000

    random = session.mode == "random"
    if random and body.survived is None:
        raise ApiError("bad_score")
    score = anticheat.round_survived(body.survived) if random else float(body.strokes)
    length = score if random else session.duration
    if not (score > 0 and length <= rules.RANDOM_MAX_SEC):
        raise ApiError("bad_score")
    if elapsed + rules.TIME_SLACK_SEC < length:
        raise ApiError("too_fast")
    if elapsed > length + rules.SUBMIT_WINDOW_SEC:
        raise ApiError("expired")

    stats = anticheat.RunStats(bins=body.bins, fps=body.fps, grip=body.grip, split=body.split)
    detail = anticheat.check_run(session.mode, session.duration, body.strokes, score, stats)
    if detail is None:
        raise ApiError("implausible")

    # Kiểm tra người thật sau cùng: các bước trên rẻ hơn một lần gọi ra ngoài
    if not await verify_human(body.captcha):
        raise ApiError("captcha")

    rank = await repo.record_run(
        run_id=session.run_id,
        pid=body.pid,
        name=body.name,
        mode=session.mode,
        duration=session.duration,
        score=score,
        strokes=body.strokes,
        detail=detail,
        now_ms=now,
    )
    if rank is None:
        raise ApiError("used")
    return RankResponse(**rank)
