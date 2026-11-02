"""Link previews for PvP invites.

Facebook, Messenger, Zalo, Telegram and Discord build a link preview from the Open Graph tags of the raw
HTML; they don't run the app's JavaScript. So for /c/<code> the Worker takes the built index.html and
swaps those tags here: a picture of its own and a line naming who is challenging, in the inviter's
language (the invite link carries `?lang=vi`, see InviteLink in frontend/src/pvp/PvpBar.tsx).

Keep in step with the tags in frontend/index.html (tests/test_invite_preview.py reads that file).
"""

import html
import re
from dataclasses import dataclass
from typing import Any

MODE_NAMES = {"single": "Single", "double": "Double"}


@dataclass(frozen=True, slots=True)
class Preview:
    title: str
    description: str
    image_alt: str
    locale: str
    locale_alt: str


def preview_for(room: dict[str, Any] | None, lang: str | None) -> Preview:
    """Text for one room. `room` is PvpRoom's preview (host, mode, duration), None once the room is gone."""
    vi = lang == "vi"
    host = room.get("host") if room else None
    mode = MODE_NAMES.get(room.get("mode", "")) if room else None
    duration = room.get("duration") if room else None
    details = f"PvP {mode} · {duration}s" if mode and isinstance(duration, int) else "PvP 1v1"
    if vi:
        return Preview(
            title=f"{host} thách đấu bạn Ambatukam" if host else "Bạn được thách đấu Ambatukam",
            description=f"{details}. Mở link, bật webcam xem ai xóc nhanh hơn. Chơi ngay trên trình duyệt.",
            image_alt="Thách đấu PvP Ambatukam: hai camera đối đầu",
            locale="vi_VN",
            locale_alt="en_US",
        )
    title = (
        f"{host} challenges you to an Ambatukam duel"
        if host
        else "You've been challenged to an Ambatukam duel"
    )
    return Preview(
        title=title,
        description=f"{details}. Open the link, turn on your webcam and see who strokes faster.",
        image_alt="Ambatukam PvP challenge: two cameras face off",
        locale="en_US",
        locale_alt="vi_VN",
    )


def render(page: str, preview: Preview, *, url: str, image: str) -> str:
    """index.html with the title, description, canonical URL and Open Graph tags of an invite."""
    out = _tag(page, r"<title>", r"</title>", preview.title)
    out = _attr(out, 'name="description"', preview.description)
    out = _attr(out, 'rel="canonical"', url, attr="href")
    for prop, value in (
        ("og:url", url),
        ("og:title", preview.title),
        ("og:description", preview.description),
        ("og:image", image),
        ("og:image:alt", preview.image_alt),
        ("og:locale", preview.locale),
        ("og:locale:alternate", preview.locale_alt),
    ):
        out = _attr(out, f'property="{prop}"', value)
    if preview.locale == "vi_VN":
        out = out.replace('<html lang="en">', '<html lang="vi">', 1)
    return out


def _tag(page: str, start: str, end: str, value: str) -> str:
    return re.sub(f"({start})[^<]*({end})", lambda m: m[1] + html.escape(value) + m[2], page, count=1)


def _attr(page: str, marker: str, value: str, *, attr: str = "content") -> str:
    """Set `attr` of the first tag carrying `marker` (e.g. property="og:title")."""
    pattern = re.compile(rf'(<[^>]*\b{re.escape(marker)}[^>]*\b{attr}=")[^"]*(")')
    return pattern.sub(lambda m: m[1] + html.escape(value, quote=True) + m[2], page, count=1)
