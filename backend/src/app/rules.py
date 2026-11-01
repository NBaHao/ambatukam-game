"""Luật chơi server cần biết để kiểm tra điểm.

Các hằng số Random (RND_*) phải khớp với frontend/src/game/constants.ts: server dựng lại thanh Lửa
theo đúng công thức client dùng.
"""

from typing import Literal

Mode = Literal["single", "double", "random"]

# duration = 0 nghĩa là không giới hạn thời gian (random)
DURATIONS: dict[str, tuple[int, ...]] = {"single": (10, 20, 30), "double": (10, 20, 30), "random": (0,)}
HANDS: dict[str, int] = {"single": 1, "double": 2, "random": 1}

# Người nhanh nhất trên bảng tới giờ ~5.4 nhát/s nên chừa dư khá nhiều
MAX_RATE_PER_HAND = 8  # nhát/giây/tay trung bình cả ván
MAX_BIN_PER_HAND = 10  # nhát/tay trong một giây bất kỳ
MIN_STROKES_FLAT = 30  # từ chừng này nhát trở lên mà giây nào cũng bằng nhau thì là máy
MAX_FPS = 240
RANDOM_MAX_SEC = 150  # Lửa cạn ngày càng nhanh: xóc đều 8 nhát/s cũng chỉ sống ~100s

TIME_SLACK_SEC = 3  # bù độ trễ mạng giữa lúc lấy token và lúc nộp điểm
SUBMIT_WINDOW_SEC = 900  # hết ván quá 15 phút thì không nộp / đổi tên được nữa

NAME_MAX = 20
TOP_N = 50

# Accounts. Usernames are lowercase like TETR.IO; "guest…" is reserved for anonymous players.
USERNAME_PATTERN = r"^[a-z0-9_-]{3,16}$"
RESERVED_PREFIX = "guest"
PASSWORD_MIN = 8
PASSWORD_MAX = 128
# PBKDF2-SHA256 iterations. Bounded by Worker CPU time (~6.6 ms per 100k measured locally):
# 100k fits the paid plan comfortably and is borderline on the free plan's 10 ms.
# Raising it is safe: logins re-hash passwords stored with fewer iterations.
PW_ITERATIONS = 100_000
SESSION_DAYS = 30
SESSION_RENEW_DAYS = 15  # /api/me pushes the expiry forward once fewer days than this remain
MAX_SESSIONS = 10  # per account; logging in on an 11th device ends the oldest session

# Random: Lửa bắt đầu 100% (tối đa 100%), cạn (10 + 0.4·t)%/giây, mỗi nhát nạp 5%
RND_START = 100
RND_DRAIN = 10
RND_RAMP = 0.4
RND_GAIN = 5


def is_valid_duration(mode: str, duration: object) -> bool:
    # bool là con của int trong Python: chặn riêng để True không thành 1
    return type(duration) is int and duration in DURATIONS.get(mode, ())
