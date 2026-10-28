"""Cloudflare Turnstile: xác minh mã client lấy được ngay trước khi gửi điểm (mỗi mã dùng một lần)."""

import json
from collections.abc import Awaitable, Callable
from urllib.parse import urlencode

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
MAX_TOKEN_LEN = 2048

# Gửi form POST, trả về JSON đã parse. Tách ra để test không phải gọi mạng.
PostForm = Callable[[str, dict[str, str]], Awaitable[dict]]


async def verify(secret: str, token: str, post_form: PostForm) -> bool:
    if not token or len(token) > MAX_TOKEN_LEN:
        return False
    result = await post_form(SITEVERIFY_URL, {"secret": secret, "response": token})
    return result.get("success") is True


async def workers_post_form(url: str, form: dict[str, str]) -> dict:
    from workers import fetch  # chỉ có trong runtime Python Workers

    res = await fetch(
        url,
        method="POST",
        body=urlencode(form),
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    return json.loads(await res.text())
