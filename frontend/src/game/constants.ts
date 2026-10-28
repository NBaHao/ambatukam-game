// ---------- Tham số tinh chỉnh ----------
export const MAX_RATE = 6; // nhát/giây ứng với thanh lực đầy
export const RATE_WINDOW_MS = 1500; // cửa sổ tính tốc độ tức thời
export const LOST_HAND_MS = 400; // mất tay quá lâu thì reset bộ đếm hướng
export const STROKE_THR = 0.25; // ngưỡng đảo chiều = 25% cỡ bàn tay
export const PALM_HOLD_MS = 1000; // xòe tay giữ bao lâu thì "sẵn sàng"
export const ANCHOR_HOLD_MS = 1000; // nắm trụ giữ yên bao lâu thì đặt điểm neo
export const ANCHOR_STILL = 0.35; // khi đặt neo, tay không được lệch quá 35% cỡ tay
export const ROD_HALF_LEN = 1.8; // nửa chiều dài trụ (theo cỡ tay)
export const ROD_TOL_X = 0.9; // tay được lệch ngang khỏi trục trụ bao nhiêu (theo cỡ tay)
export const ROD_MAX_HALF = 0.3; // nửa trụ không dài quá 30% chiều cao khung: điện thoại để gần, tay to, trụ tràn khung
export const INVALID_GRACE_MS = 150; // tay sai tư thế / lệch trụ quá lâu thì nhát đang dở bị huỷ
export const GRIP_MAX_AVG = 1.45; // trung bình độ duỗi 4 ngón dưới mức này = đang nắm (để đặt neo)
export const OPEN_MIN_CURL = 1.6; // ngón duỗi hơn mức này = duỗi thẳng; cả 4 ngón duỗi = xòe tay
export const RELEASE_FINGERS = 3; // đang chơi: từ 3 ngón duỗi thẳng trở lên mới coi là buông trụ
export const ANCHOR_ZONE_X = 0.25; // single: điểm neo phải cách tâm khung hình (ngang) không quá 25%
export const ANCHOR_ZONE_Y = 0.3;
export const DOUBLE_ZONE_X = 0.42; // double: mỗi tay cách tâm (ngang) không quá 42%
export const HAND_MIN_GAP = 2.2; // double: hai điểm neo cách nhau ít nhất 2.2 cỡ tay
export const TIER_MIN = [0, 1, 2, 3, 4, 5]; // ngưỡng nhát/giây (mỗi tay) của từng danh hiệu
export const COUNTDOWN_STEPS = ["3", "2", "1", "GO"];
export const COUNTDOWN_STEP_MS = 800;

// ---------- Random ----------
// RND_METER_START / RND_DRAIN_* / RND_STROKE_GAIN phải khớp backend/src/app/rules.py (server dựng lại thanh Lửa)
export const RND_METER_START = 100; // Lửa ban đầu (%)
export const RND_DRAIN_BASE = 10; // Lửa cạn %/giây lúc đầu
export const RND_DRAIN_RAMP = 0.4; // mỗi giây trôi qua, tốc độ cạn tăng thêm %/giây
export const RND_STROKE_GAIN = 5; // mỗi nhát đúng trụ nạp thêm %
export const RND_ROD_LIFE_MAX = 5000; // trụ tồn tại bao lâu rồi nhảy chỗ khác (ms), giảm dần theo thời gian
export const RND_ROD_LIFE_MIN = 2500;
export const RND_ROD_LIFE_STEP = 100; // ms giảm mỗi giây chơi
export const RND_TILT_MAX = 45; // độ nghiêng tối đa của trụ ngẫu nhiên (độ)
export const RND_MIN_JUMP = 0.25; // trụ mới cách trụ cũ ít nhất (theo chiều cao khung)
export const RND_TIER_SEC = [0, 10, 20, 30, 45, 60]; // ngưỡng giây sống sót của từng danh hiệu

// ---------- Landmark MediaPipe ----------
// Chỗ thân trụ nằm trong nắm tay: giữa khớp gốc ngón (MCP) và khớp giữa ngón (PIP), không tính cổ tay
export const GRIP_IDS = [5, 6, 9, 10, 13, 14, 17, 18];
export const FINGERS: [tip: number, mcp: number][] = [[8, 5], [12, 9], [16, 13], [20, 17]];
