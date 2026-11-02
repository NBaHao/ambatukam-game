from fastapi import APIRouter, Depends, Response

from app import clock, rules
from app.dependencies import (
    Env,
    HumanVerifierDep,
    KdfDep,
    MailerDep,
    SessionDep,
    SettingsDep,
    UsersDep,
    enforce_limit,
    rate_limit,
)
from app.errors import ApiError
from app.schemas import (
    EmailChange,
    LoginRequest,
    MeResponse,
    RegisterRequest,
    ResetAvailableResponse,
    ResetComplete,
    ResetRequest,
    ResetSentResponse,
    User,
    Username,
    UsernameExistsResponse,
)
from app.services import accounts, resets

router = APIRouter(tags=["accounts"])

_auth_limit = [Depends(rate_limit("AUTH_LIMIT"))]


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        accounts.COOKIE,
        token,
        max_age=rules.SESSION_DAYS * 86_400,
        path="/api",
        httponly=True,
        secure=True,
        samesite="lax",
    )


@router.get("/users/{username}/exists", dependencies=[Depends(rate_limit("SESSION_LIMIT"))])
async def username_exists(username: Username, users: UsersDep) -> UsernameExistsResponse:
    """The username box asks this to decide between "log in" and "want to join?"."""
    return UsernameExistsResponse(exists=await users.by_username(username) is not None)


@router.post("/auth/register", dependencies=_auth_limit)
async def register(
    body: RegisterRequest, response: Response, users: UsersDep, kdf: KdfDep, verify_human: HumanVerifierDep
) -> MeResponse:
    """Create an account (email optional). The device's pid and its scores move into it."""
    if not await verify_human(body.captcha):
        raise ApiError("captcha")
    user, token = await accounts.register(
        users,
        kdf,
        username=body.username,
        password=body.password,
        email=body.email,
        pid=body.pid,
        now_ms=clock.now_ms(),
    )
    _set_cookie(response, token)
    return MeResponse(user=User(**accounts.public_user(user)))


@router.post("/auth/login", dependencies=_auth_limit)
async def login(body: LoginRequest, response: Response, env: Env, users: UsersDep, kdf: KdfDep) -> MeResponse:
    # Besides the per-IP limit: cap guesses per account, so spreading them over many IPs doesn't help
    await enforce_limit(env, "LOGIN_NAME_LIMIT", body.username)
    user, token = await accounts.login(
        users, kdf, username=body.username, password=body.password, now_ms=clock.now_ms()
    )
    _set_cookie(response, token)
    return MeResponse(user=User(**accounts.public_user(user)))


@router.post("/auth/logout")
async def logout(response: Response, users: UsersDep, session: SessionDep) -> MeResponse:
    if session is not None:
        await users.delete_session(session.token_hash)
    response.delete_cookie(accounts.COOKIE, path="/api", httponly=True, secure=True, samesite="lax")
    return MeResponse(user=None)


@router.get("/me")
async def me(response: Response, users: UsersDep, session: SessionDep) -> MeResponse:
    """Who is logged in (null for guests). Called on page load, so it also renews old sessions."""
    if session is None:
        return MeResponse(user=None)
    now = clock.now_ms()
    if session.expires_at - now < rules.SESSION_RENEW_DAYS * accounts.DAY_MS:
        await users.extend_session(session.token_hash, accounts.session_expiry(now))
    return MeResponse(user=User(**accounts.public_user(session.user)))


@router.get("/auth/reset")
async def reset_available(send: MailerDep) -> ResetAvailableResponse:
    """Whether "forgot password" can email a link (the server has an email service)."""
    return ResetAvailableResponse(available=send is not None)


@router.post("/auth/reset/request", dependencies=_auth_limit)
async def reset_request(
    body: ResetRequest,
    env: Env,
    settings: SettingsDep,
    users: UsersDep,
    send: MailerDep,
    verify_human: HumanVerifierDep,
) -> ResetSentResponse:
    """Email a reset link to the account's address, if it has one. The answer is the same either way."""
    if send is None:
        raise ApiError("reset_unavailable", 503)
    if not await verify_human(body.captcha):
        raise ApiError("captcha")
    await enforce_limit(env, "LOGIN_NAME_LIMIT", body.username)
    await resets.request(
        users, send, username=body.username, origin=settings.app_origin, lang=body.lang, now=clock.now_ms()
    )
    return ResetSentResponse(retry_in=rules.RESET_GAP_SEC)


@router.post("/auth/reset", dependencies=_auth_limit)
async def reset_complete(body: ResetComplete, response: Response, users: UsersDep, kdf: KdfDep) -> MeResponse:
    """Set a new password from an email link: logs out every device, then logs this one in."""
    user, token = await resets.complete(
        users, kdf, token=body.token, password=body.password, now=clock.now_ms()
    )
    _set_cookie(response, token)
    return MeResponse(user=User(**accounts.public_user(user)))


@router.put("/me/email", dependencies=_auth_limit)
async def change_email(
    body: EmailChange, env: Env, users: UsersDep, kdf: KdfDep, session: SessionDep
) -> MeResponse:
    """Add, change or remove the email used for password resets (needs the current password)."""
    if session is None:
        raise ApiError("login_required", 401)
    await enforce_limit(env, "LOGIN_NAME_LIMIT", session.user["username"])
    await resets.change_email(users, kdf, session.user, email=body.email, password=body.password)
    user = {**session.user, "email": body.email}
    return MeResponse(user=User(**accounts.public_user(user)))
