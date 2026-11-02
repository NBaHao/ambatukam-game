"""Video / voice between PvP opponents (WebRTC): ICE servers for the browser.

Media goes peer to peer, relayed through Cloudflare's TURN service so neither player learns the other's
IP address. Without TURN credentials the feature is off, unless RTC_ALLOW_DIRECT is set (local dev only:
direct connections expose IP addresses to the opponent).
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.errors import ApiError

TURN_URL = "https://rtc.live.cloudflare.com/v1/turn/keys/{key}/credentials/generate-ice-servers"
STUN_ONLY = [{"urls": ["stun:stun.cloudflare.com:3478"]}]
ICE_TTL_SEC = 4 * 3600

PostJson = Callable[[str, dict[str, Any], dict[str, str]], Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class RtcConfig:
    turn_key_id: str | None
    turn_api_token: str | None
    allow_direct: bool

    @property
    def turn(self) -> bool:
        return bool(self.turn_key_id and self.turn_api_token)


def _clean(servers: Any) -> list[dict[str, Any]]:
    """Keep well-formed entries; drop port 53 URLs (browsers block them and wait for a timeout)."""
    if isinstance(servers, dict):
        servers = [servers]
    out = []
    for s in servers if isinstance(servers, list) else []:
        if not isinstance(s, dict):
            continue
        urls = s.get("urls")
        urls = [urls] if isinstance(urls, str) else urls
        if not isinstance(urls, list):
            continue
        urls = [u for u in urls if isinstance(u, str) and ":53?" not in u and not u.endswith(":53")]
        if urls:
            entry: dict[str, Any] = {"urls": urls}
            for k in ("username", "credential"):
                if isinstance(s.get(k), str):
                    entry[k] = s[k]
            out.append(entry)
    return out


async def ice_servers(cfg: RtcConfig, post_json: PostJson) -> dict[str, Any]:
    """{"ice_servers": [...], "relay": bool}: relay = the browser must only use TURN (hides IPs)."""
    if cfg.turn:
        try:
            res = await post_json(
                TURN_URL.format(key=cfg.turn_key_id),
                {"ttl": ICE_TTL_SEC},
                {"Authorization": f"Bearer {cfg.turn_api_token}"},
            )
        except Exception as exc:
            print(f"rtc: TURN credentials failed: {exc!r}")
            raise ApiError("rtc_unavailable", 503) from exc
        servers = _clean(res.get("iceServers"))
        if not any("credential" in s for s in servers):
            print("rtc: TURN response had no credentials")
            raise ApiError("rtc_unavailable", 503)
        return {"ice_servers": servers, "relay": True}
    if cfg.allow_direct:
        return {"ice_servers": STUN_ONLY, "relay": False}
    raise ApiError("rtc_unavailable", 503)


async def workers_post_json(url: str, body: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
    from workers import fetch  # only in the Python Workers runtime

    res = await fetch(
        url, method="POST", body=json.dumps(body), headers={**headers, "content-type": "application/json"}
    )
    if res.status >= 400:
        raise RuntimeError(f"TURN API {res.status}")
    return json.loads(await res.text())
