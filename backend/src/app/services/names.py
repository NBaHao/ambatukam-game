import re
import unicodedata

from app.rules import NAME_MAX

_SPACES = re.compile(r"\s+")


def clean_name(raw: str) -> str:
    """Chuẩn hoá NFC, bỏ ký tự điều khiển / vô hình (Unicode nhóm C), gộp khoảng trắng, cắt NAME_MAX ký tự."""
    s = unicodedata.normalize("NFC", raw)
    s = "".join(ch for ch in s if not unicodedata.category(ch).startswith("C"))
    s = _SPACES.sub(" ", s).strip()
    return s[:NAME_MAX].strip()
