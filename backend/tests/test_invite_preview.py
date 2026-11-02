"""Link previews of PvP invite links (app/services/invite_preview.py), against the real index.html."""

import re
from pathlib import Path
from typing import Any

from app.services.invite_preview import preview_for, render
from app.services.room import RoomLogic
from app.services.tickets import Ticket

INDEX = (Path(__file__).parents[2] / "frontend" / "index.html").read_text()
URL = "https://ambatukam.bahao.site/c/abc234"
IMAGE = "https://ambatukam.bahao.site/og-invite.png"


def page_for(room: dict[str, Any] | None, lang: str | None = None) -> str:
    return render(INDEX, preview_for(room, lang), url=URL, image=IMAGE)


def meta(page: str, marker: str, attr: str = "content") -> str:
    m = re.search(rf'<[^>]*{re.escape(marker)}[^>]*\b{attr}="([^"]*)"', page)
    assert m, marker
    return m[1]


def test_room_preview_shows_host_and_settings_only() -> None:
    assert RoomLogic(None).preview() is None
    room = RoomLogic(None)
    host = Ticket("abc234", "pid-a", "haro", registered=False, expires_ms=10**15, mode="double", duration=30)
    room.join(host, "cid-a", 1_800_000_000_000)
    assert room.preview() == {"host": "haro", "mode": "double", "duration": 30}


def test_every_preview_tag_is_replaced() -> None:
    page = page_for({"host": "haro", "mode": "single", "duration": 20})
    title = "haro challenges you to an Ambatukam duel"
    assert re.search(r"<title>([^<]*)</title>", page)[1] == title  # type: ignore[index]
    assert meta(page, 'property="og:title"') == title
    assert meta(page, 'property="og:description"').startswith("PvP Single · 20s.")
    assert meta(page, 'name="description"').startswith("PvP Single · 20s.")
    assert meta(page, 'property="og:url"') == URL
    assert meta(page, 'rel="canonical"', "href") == URL
    assert meta(page, 'property="og:image"') == IMAGE
    assert meta(page, 'property="og:image:alt"') != meta(INDEX, 'property="og:image:alt"')
    assert meta(page, 'property="og:locale"') == "en_US"
    # The rest of the page (the app itself) is untouched
    assert page.count("<meta") == INDEX.count("<meta")
    assert '<div id="root"></div>' in page


def test_vietnamese_invite() -> None:
    page = page_for({"host": "haro", "mode": "double", "duration": 10}, "vi")
    assert meta(page, 'property="og:title"') == "haro thách đấu bạn Ambatukam"
    assert meta(page, 'property="og:description"').startswith("PvP Double · 10s.")
    assert meta(page, 'property="og:locale"') == "vi_VN"
    assert meta(page, 'property="og:locale:alternate"') == "en_US"
    assert '<html lang="vi">' in page


def test_closed_room_gets_a_generic_invite() -> None:
    en = preview_for(None, None)
    assert en.title == "You've been challenged to an Ambatukam duel"
    assert en.description.startswith("PvP 1v1.")
    no_host = preview_for({"host": None, "mode": "single", "duration": 20}, "vi")
    assert no_host.title == "Bạn được thách đấu Ambatukam"
    assert preview_for(None, "fr").locale == "en_US"  # unknown languages fall back to English


def test_host_name_is_escaped() -> None:
    page = page_for({"host": '"><script>x</script>', "mode": "single", "duration": 20})
    assert "<script>x" not in page
    assert meta(page, 'property="og:title"').startswith("&quot;&gt;&lt;script&gt;")
