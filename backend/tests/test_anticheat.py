from app.services.anticheat import RunStats, check_run, round_survived, survivable


def stats(bins: list[int], fps: float = 30, grip: int = 90, split: list[int] | None = None) -> RunStats:
    return RunStats(bins=bins, fps=fps, grip=grip, split=split)


def test_legit_single_run_passes():
    bins = [3, 4, 4, 5, 4, 4, 4, 4, 4, 3]
    assert check_run("single", 10, 39, 39, stats(bins)) == {"bins": bins, "fps": 30, "grip": 90}


def test_bins_must_sum_to_strokes():
    assert check_run("single", 10, 40, 40, stats([4] * 9 + [3])) is None


def test_bins_length_must_match_duration():
    assert check_run("single", 10, 36, 36, stats([4] * 9)) is None


def test_bin_over_human_limit_rejected():
    assert check_run("single", 10, 20, 20, stats([11, 9] + [0] * 8)) is None


def test_average_rate_cap():
    # 9 nhát/s mỗi giây: không giây nào vượt 10 nhưng trung bình vượt 8
    assert check_run("single", 10, 90, 90, stats([9, 10, 8, 9, 9, 10, 8, 9, 9, 9])) is None


def test_peak_bounded_by_frame_rate():
    bins = [8, 2] + [1] * 8
    assert check_run("single", 10, sum(bins), sum(bins), stats(bins, fps=12)) is None
    assert check_run("single", 10, sum(bins), sum(bins), stats(bins, fps=30)) is not None


def test_low_grip_rejected():
    assert check_run("single", 10, 39, 39, stats([3, 4, 4, 5, 4, 4, 4, 4, 4, 3], grip=10)) is None


def test_flat_bins_rejected():
    assert check_run("single", 10, 40, 40, stats([4] * 10)) is None


def test_double_split_must_sum():
    bins = [6, 7, 8, 7, 6, 7, 8, 7, 6, 8]
    assert check_run("double", 10, 70, 70, stats(bins, split=[35, 35])) is not None
    assert check_run("double", 10, 70, 70, stats(bins, split=[35, 30])) is None
    assert check_run("double", 10, 70, 70, stats(bins)) is None


def test_random_survivable():
    bins = [3] * 23 + [1]
    assert check_run("random", 0, sum(bins), 23.4, stats(bins)) is not None


def test_random_strokes_only_at_end_rejected():
    bins = [0] * 20 + [10, 10]
    assert not survivable(bins, 21.5)
    assert check_run("random", 0, 20, 21.5, stats(bins)) is None


def test_round_survived_matches_js_math_round():
    assert round_survived(12.25) == 12.3
    assert round_survived(0.05) == 0.1
