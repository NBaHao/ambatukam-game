"""Kiểm tra một ván có hợp lý không.

Điểm tính ở client nên không chống gian lận tuyệt đối được. Server chỉ làm khó hơn:
- so thời lượng thật (từ token) với điểm nộp lên, quá hạn nộp thì từ chối
- đối chiếu số nhát từng giây, FPS camera, tỉ lệ bám trụ với tổng điểm và với sức người
- random: dựng lại thanh Lửa xem có sống nổi tới lúc khai không
"""

import math
from dataclasses import dataclass
from typing import Any

from app import rules


@dataclass(frozen=True, slots=True)
class RunStats:
    """Số liệu chi tiết client gửi kèm điểm."""

    bins: list[int]  # số nhát từng giây
    fps: float  # số khung camera xử lý được mỗi giây
    grip: int  # % khung hình mọi tay đều nằm trên trụ
    split: list[int] | None = None  # double: số nhát của từng tay


def round_survived(survived: float) -> float:
    """Làm tròn 0.1 giây theo kiểu Math.round của JS (0.5 làm tròn lên) để khớp client."""
    return math.floor(survived * 10 + 0.5) / 10


def check_run(mode: str, duration: int, strokes: int, score: float, run: RunStats) -> dict[str, Any] | None:
    """Trả về số liệu để lưu lại (bảng runs), hoặc None nếu ván vô lý."""
    hands = rules.HANDS[mode]
    bins = run.bins
    if any(not 0 <= b <= rules.MAX_BIN_PER_HAND * hands for b in bins):
        return None
    if sum(bins) != strokes:
        return None
    if not (math.isfinite(run.fps) and 0 < run.fps <= rules.MAX_FPS):
        return None
    # Mỗi nhát cần ít nhất một khung đi xuống và một khung đi lên
    if max(bins, default=0) > hands * run.fps / 2 + 1:
        return None
    if not 0 <= run.grip <= 100:
        return None
    detail: dict[str, Any] = {"bins": bins, "fps": run.fps, "grip": run.grip}

    if mode == "random":
        if abs(len(bins) - math.ceil(score)) > 1:
            return None
        if strokes > rules.MAX_RATE_PER_HAND * score:
            return None
        return detail if survivable(bins, score) else None

    if len(bins) != duration:
        return None
    if strokes > rules.MAX_RATE_PER_HAND * hands * duration:
        return None
    # Chỉ nhát xóc trên trụ mới được đếm. Cộng 2 giây bù cho nhát vắt qua lúc rời trụ.
    if strokes > rules.MAX_BIN_PER_HAND * hands * (duration * run.grip / 100 + 2):
        return None
    if strokes >= rules.MIN_STROKES_FLAT and all(b == bins[0] for b in bins):
        return None
    if mode == "double":
        split = run.split
        if split is None or len(split) != 2:
            return None
        if any(not 0 <= c <= rules.MAX_RATE_PER_HAND * duration for c in split) or sum(split) != strokes:
            return None
        detail["split"] = split
    return detail


def survivable(bins: list[int], survived: float) -> bool:
    """Random: dựng lại Lửa theo số nhát từng giây.

    Tính lạc quan (nạp hết số nhát của giây rồi mới trừ phần cạn, chỉ chặn trần 100% ở cuối giây)
    nên luôn ≥ Lửa thật. Lửa lạc quan mà đã cạn trước lúc thua thì là bịa.
    """
    meter = float(rules.RND_START)
    i = 0
    while i + 1 <= survived - 0.5:
        gained = rules.RND_GAIN * (bins[i] if i < len(bins) else 0)
        drained = rules.RND_DRAIN + rules.RND_RAMP * (i + 0.5)
        meter = min(rules.RND_START, meter + gained - drained)
        if meter < -rules.RND_GAIN * 2:
            return False
        i += 1
    return True
