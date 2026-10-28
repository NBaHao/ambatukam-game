"""Đồng hồ dùng chung, tách riêng để test thay được thời gian."""

import time


def now_ms() -> int:
    return int(time.time() * 1000)
