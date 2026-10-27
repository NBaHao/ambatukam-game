// Ambatukam Game
// Đếm số nhát xóc dọc theo một "thanh trụ ảo" đặt tại điểm neo. Nhận diện tay bằng
// MediaPipe Hand Landmarker, chạy hoàn toàn trong trình duyệt.
//
// Chế độ:
//   single  — 1 tay, 1 trụ, thời gian cố định, tính nhát/giây trung bình
//   double  — 2 tay, 2 trụ, thời gian cố định
//   random  — trụ xuất hiện ngẫu nhiên, phải đuổi theo; thanh Lửa cạn dần, hết Lửa là thua
import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
// API leaderboard chạy cùng Worker với trang game (xem worker/src/index.js)
const API_URL = "";

// ---------- Tham số tinh chỉnh ----------
const MAX_RATE = 6;           // nhát/giây ứng với thanh lực đầy
const RATE_WINDOW_MS = 1500;  // cửa sổ tính tốc độ tức thời
const LOST_HAND_MS = 400;     // mất tay quá lâu thì reset bộ đếm hướng
const STROKE_THR = 0.25;      // ngưỡng đảo chiều = 25% cỡ bàn tay
const PALM_HOLD_MS = 1000;    // xòe tay giữ bao lâu thì "sẵn sàng"
const ANCHOR_HOLD_MS = 1000;  // nắm trụ giữ yên bao lâu thì đặt điểm neo
const ANCHOR_STILL = 0.35;    // khi đặt neo, tay không được lệch quá 35% cỡ tay
const ROD_HALF_LEN = 1.8;     // nửa chiều dài trụ (theo cỡ tay)
const ROD_TOL_X = 0.9;        // tay được lệch ngang khỏi trục trụ bao nhiêu (theo cỡ tay)
// Trục trụ = đường nối khớp ngón trỏ → khớp ngón út lúc đặt neo (khi nắm trụ, các khớp xếp dọc theo trụ)
const INVALID_GRACE_MS = 150; // tay sai tư thế / lệch trụ quá lâu thì nhát đang dở bị huỷ
const GRIP_MAX_AVG = 1.45;    // trung bình độ duỗi 4 ngón dưới mức này = đang nắm (để đặt neo)
const OPEN_MIN_CURL = 1.6;    // ngón duỗi hơn mức này = duỗi thẳng; cả 4 ngón duỗi = xòe tay
const RELEASE_FINGERS = 3;    // đang chơi: từ 3 ngón duỗi thẳng trở lên mới coi là buông trụ
const ANCHOR_ZONE_X = 0.25;   // single: điểm neo phải cách tâm khung hình (ngang) không quá 25%
const ANCHOR_ZONE_Y = 0.3;
const DOUBLE_ZONE_X = 0.42;   // double: mỗi tay cách tâm (ngang) không quá 42%
const HAND_MIN_GAP = 2.2;     // double: hai điểm neo cách nhau ít nhất 2.2 cỡ tay
const TIER_MIN = [0, 1, 2, 3, 4, 5]; // ngưỡng nhát/giây (mỗi tay) của từng danh hiệu
// Random
const RND_METER_START = 100;  // Lửa ban đầu (%)
const RND_DRAIN_BASE = 10;    // Lửa cạn %/giây lúc đầu
const RND_DRAIN_RAMP = 0.4;   // mỗi giây trôi qua, tốc độ cạn tăng thêm %/giây
const RND_STROKE_GAIN = 5;    // mỗi nhát đúng trụ nạp thêm %
const RND_ROD_LIFE_MAX = 5000;// trụ tồn tại bao lâu rồi nhảy chỗ khác (ms), giảm dần theo thời gian
const RND_ROD_LIFE_MIN = 2500;
const RND_ROD_LIFE_STEP = 100;// ms giảm mỗi giây chơi
const RND_TILT_MAX = 45;      // độ nghiêng tối đa của trụ ngẫu nhiên (độ)
const RND_MIN_JUMP = 0.25;    // trụ mới cách trụ cũ ít nhất (theo chiều cao khung)
const RND_TIER_SEC = [0, 10, 20, 30, 45, 60]; // ngưỡng giây sống sót của từng danh hiệu

const PALM_IDS = [0, 5, 9, 13, 17];
const FINGERS = [[8, 5], [12, 9], [16, 13], [20, 17]]; // [đầu ngón, gốc ngón]

// ---------- Ngôn ngữ ----------
const STRINGS = {
  vi: {
    title: "Ambatukam Challenge",
    modeSingle: "Single", modeSingleDesc: "1 tay · 1 trụ · đo tốc độ",
    modeDouble: "Double", modeDoubleDesc: "2 tay · 2 trụ · gấp đôi",
    modeRandom: "Random", modeRandomDesc: "Trụ nhảy lung tung · sống sót",
    modeRank: "Rank", modePvp: "PvP", soon: "Sắp có",
    subSingle: "Nắm tay như cầm một thanh trụ, xóc lên xuống thật nhanh trước camera. Hết giờ, máy tính tốc độ trung bình của bạn.",
    subDouble: "Hai tay, hai trụ. Cả hai cùng xóc, cộng dồn số nhát. Hết giờ, tính tốc độ trung bình.",
    subRandom: "Trụ xuất hiện ngẫu nhiên và liên tục đổi chỗ. Đuổi theo mà xóc để giữ Lửa. Lửa cạn là thua, sống càng lâu càng tốt.",
    start: "Bật camera & chơi",
    keyboard: "Không có camera? Chơi bằng phím ↑ ↓",
    keyboardTouch: "Không có camera? Chơi bằng cách chạm",
    fine: "Game meme giải trí, 16+. Không có hình ảnh nhạy cảm. Video không rời khỏi máy bạn.",
    bestLine: (n, d) => `Kỷ lục ${d}s: ${n} nhát · ${(n / d).toFixed(2)} nhát/s`,
    bestLineRandom: (s) => `Kỷ lục: sống sót ${s.toFixed(1)}s`,
    steps: {
      single: ["<b>Xòe tay</b>, giữ 1 giây = sẵn sàng", "<b>Nắm tay như cầm trụ</b>, giữ yên 1 giây = đặt điểm neo. Trụ nghiêng theo hướng tay bạn", "Xóc <b>lên xuống dọc trụ</b>. Lệch trụ hoặc xòe tay thì không tính"],
      double: ["<b>Xòe một tay</b>, giữ 1 giây = sẵn sàng", "<b>Nắm cả hai tay</b> như cầm hai trụ, giữ yên 1 giây = đặt hai điểm neo", "Xóc cả hai tay dọc trụ của mỗi tay. Nhát của hai tay cộng dồn"],
      random: ["<b>Xòe tay</b>, giữ 1 giây = sẵn sàng", "Trụ hiện ở chỗ ngẫu nhiên. <b>Nắm tay tới đó</b> và xóc dọc trụ", "Mỗi nhát nạp <b>Lửa</b>, Lửa cạn dần ngày càng nhanh. Trụ đổi chỗ liên tục. Hết Lửa là dừng"],
    },
    go: "Sẵn sàng",
    opening: "Đang mở camera…",
    loading: "Đang tải mô hình nhận diện tay…",
    camError: (m) => `Không mở được camera: ${m}. Thử chế độ phím.`,
    kbHint: "Chế độ phím: bấm <b>↑</b> và <b>↓</b> luân phiên, hoặc chạm nửa trên / nửa dưới khung hình.",
    gPalmReady: "✋ Xòe tay, giữ 1 giây để <b>sẵn sàng</b>",
    gPalmReplay: "✋ Xòe tay, giữ 1 giây để <b>chơi lại</b>",
    gGrip: "✊ Nắm tay như đang <b>cầm một thanh trụ</b>",
    gGripBoth: "✊✊ Nắm <b>cả hai tay</b> như cầm hai trụ",
    gTwoHands: "Đưa <b>cả hai tay</b> vào khung hình",
    gCenter: "Đưa tay vào <b>gần giữa khung hình</b>",
    gApart: "Hai tay <b>cách xa nhau</b> hơn",
    gHold: "Giữ yên để đặt <b>điểm neo</b>",
    gCountdown: "Giữ tay trên trụ, chuẩn bị…",
    gCountdownRandom: "Nắm tay tới chỗ trụ, chuẩn bị…",
    strokes: "nhát",
    power: "Lực",
    heat: "Lửa",
    perSec: "nhát/s",
    sLost: "Mất dấu tay. Thêm ánh sáng sẽ đỡ nhòe",
    sGrip: "Nắm tay lại",
    sAnchor: "Quay lại điểm neo",
    sGoRod: "Tới trụ mới!",
    sOneHand: "Thiếu một tay",
    avg: "nhát / giây trung bình",
    survived: "giây sống sót",
    total: "tổng nhát",
    peak: "đỉnh / giây",
    gripLabel: "bám trụ",
    rods: "trụ đã bắt",
    newBest: (prev) => `Kỷ lục mới · cũ ${prev}`,
    firstBest: "Kỷ lục đầu tiên",
    bestShort: (n, d) => `Kỷ lục ${d}s: ${n} nhát`,
    bestShortRandom: (s) => `Kỷ lục: ${s}s`,
    again: "Chơi lại",
    share: "Lưu ảnh",
    home: "Đổi chế độ",
    chartLabel: "nhát mỗi giây",
    board: "Bảng xếp hạng",
    back: "Quay lại",
    namePh: "Tên trên bảng xếp hạng",
    submit: "Gửi điểm",
    rename: "Đổi tên",
    submitting: "Đang gửi điểm…",
    rankLine: (name, r, n) => `${name} · hạng #${r} / ${n}`,
    submitErr: "Không gửi được điểm. Thử lại nhé",
    submitRejected: "Điểm không hợp lệ nên không được xếp hạng",
    noRankKb: "Chơi bằng phím không được xếp hạng",
    noRankZero: "Chưa có điểm để xếp hạng",
    boardLoading: "Đang tải…",
    boardEmpty: "Chưa có ai. Làm người đầu tiên!",
    boardErr: "Không tải được bảng xếp hạng",
    boardMe: (r, n, s) => `Bạn đang hạng #${r} / ${n} · ${s}`,
    strokesN: (n) => `${n} nhát`,
    shareText: (r) => `Tôi đạt ${r} nhát/s trong Ambatukam Game`,
    shareTextRandom: (s) => `Tôi sống sót ${s}s trong Ambatukam Random`,
    shareSub: (n, d, p) => `${n} nhát trong ${d}s · đỉnh ${p}/s`,
    shareSubRandom: (n, r) => `${n} nhát · ${r} trụ`,
    tiers: [
      ["Rùa bò", "Còn chưa khởi động xong."],
      ["Khởi động", "Tay bắt đầu nóng rồi."],
      ["Ambatu…", "Sắp tới rồi, cố thêm chút nữa."],
      ["Ambatukam", "Chuẩn trend. Cơ tay cảm ơn bạn."],
      ["Tay thép", "Tốc độ này đi thi được rồi."],
      ["Huyền thoại", "Không ai cản nổi bạn."],
    ],
  },
  en: {
    title: "Ambatukam Challenge",
    modeSingle: "Single", modeSingleDesc: "1 hand · 1 rod · speed test",
    modeDouble: "Double", modeDoubleDesc: "2 hands · 2 rods · twice the work",
    modeRandom: "Random", modeRandomDesc: "Rod keeps moving · survive",
    modeRank: "Rank", modePvp: "PvP", soon: "Coming soon",
    subSingle: "Grip like you're holding a rod, then stroke up and down as fast as you can. When time's up, we score your average speed.",
    subDouble: "Two hands, two rods. Stroke both at once; strokes add up. When time's up, we score your average speed.",
    subRandom: "The rod spawns at random and keeps relocating. Chase it and stroke to keep your Heat up. Heat hits zero, game over. Survive as long as you can.",
    start: "Turn on camera & play",
    keyboard: "No camera? Play with ↑ ↓ keys",
    keyboardTouch: "No camera? Play by tapping",
    fine: "Meme game for fun, 16+. No explicit imagery. Video never leaves your device.",
    bestLine: (n, d) => `Best ${d}s: ${n} strokes · ${(n / d).toFixed(2)}/s`,
    bestLineRandom: (s) => `Best: survived ${s.toFixed(1)}s`,
    steps: {
      single: ["<b>Open palm</b>, hold 1s = ready", "<b>Grip like holding a rod</b>, hold still 1s = set anchor. The rod tilts to match your hand", "Stroke <b>up and down along the rod</b>. Drifting off or opening your hand doesn't count"],
      double: ["<b>Open one palm</b>, hold 1s = ready", "<b>Grip with both hands</b> like holding two rods, hold still 1s = set both anchors", "Stroke both hands along their rods. Strokes from both hands add up"],
      random: ["<b>Open palm</b>, hold 1s = ready", "A rod spawns somewhere random. <b>Grip and move to it</b>, then stroke along it", "Each stroke adds <b>Heat</b>; Heat drains faster over time. The rod keeps relocating. Zero Heat ends the run"],
    },
    go: "Ready",
    opening: "Opening camera…",
    loading: "Loading hand-tracking model…",
    camError: (m) => `Couldn't open camera: ${m}. Try keyboard mode.`,
    kbHint: "Keyboard mode: alternate <b>↑</b> and <b>↓</b>, or tap the top / bottom half of the frame.",
    gPalmReady: "✋ Open palm, hold 1s to get <b>ready</b>",
    gPalmReplay: "✋ Open palm, hold 1s to <b>play again</b>",
    gGrip: "✊ Grip like you're <b>holding a rod</b>",
    gGripBoth: "✊✊ Grip with <b>both hands</b> like holding two rods",
    gTwoHands: "Bring <b>both hands</b> into frame",
    gCenter: "Move your hand <b>closer to the center</b>",
    gApart: "Move your hands <b>further apart</b>",
    gHold: "Hold still to set the <b>anchor</b>",
    gCountdown: "Keep your hand on the rod, get set…",
    gCountdownRandom: "Grip and move to the rod, get set…",
    strokes: "strokes",
    power: "Power",
    heat: "Heat",
    perSec: "per sec",
    sLost: "Lost your hand. More light reduces blur",
    sGrip: "Grip again",
    sAnchor: "Back to the anchor",
    sGoRod: "Go to the new rod!",
    sOneHand: "One hand missing",
    avg: "strokes / sec average",
    survived: "seconds survived",
    total: "total strokes",
    peak: "peak / sec",
    gripLabel: "on rod",
    rods: "rods caught",
    newBest: (prev) => `New best · was ${prev}`,
    firstBest: "First record",
    bestShort: (n, d) => `Best ${d}s: ${n} strokes`,
    bestShortRandom: (s) => `Best: ${s}s`,
    again: "Play again",
    share: "Save image",
    home: "Change mode",
    chartLabel: "strokes per second",
    board: "Leaderboard",
    back: "Back",
    namePh: "Name on the leaderboard",
    submit: "Submit",
    rename: "Change name",
    submitting: "Submitting score…",
    rankLine: (name, r, n) => `${name} · rank #${r} of ${n}`,
    submitErr: "Couldn't submit your score. Try again",
    submitRejected: "Score rejected, not ranked",
    noRankKb: "Keyboard runs aren't ranked",
    noRankZero: "No score to rank yet",
    boardLoading: "Loading…",
    boardEmpty: "Nobody yet. Be the first!",
    boardErr: "Couldn't load the leaderboard",
    boardMe: (r, n, s) => `You're #${r} of ${n} · ${s}`,
    strokesN: (n) => `${n} strokes`,
    shareText: (r) => `I hit ${r} strokes/s in Ambatukam Game`,
    shareTextRandom: (s) => `I survived ${s}s in Ambatukam Random`,
    shareSub: (n, d, p) => `${n} strokes in ${d}s · peak ${p}/s`,
    shareSubRandom: (n, r) => `${n} strokes · ${r} rods`,
    tiers: [
      ["Turtle", "Still warming up."],
      ["Warm-up", "Your hand is getting there."],
      ["Ambatu…", "Almost. Push a little more."],
      ["Ambatukam", "Trend-certified. Your forearm thanks you."],
      ["Iron hand", "That's competition speed."],
      ["Legend", "Nobody can stop you."],
    ],
  },
};

let lang = localStorage.getItem("ambatukam_lang") || (navigator.language.startsWith("vi") ? "vi" : "en");
function t(key, ...args) {
  const v = STRINGS[lang][key];
  return typeof v === "function" ? v(...args) : v;
}

// ---------- Bộ phát hiện nhát (hysteresis theo trục dọc) ----------
// y tăng = đi xuống. Một nhát = xuống rồi lên, được đếm tại điểm đảo chiều ở đáy.
class StrokeDetector {
  constructor() { this.reset(); }
  reset() { this.dir = 0; this.ext = null; }
  push(y, thr) {
    if (this.ext === null) { this.ext = y; return null; }
    if (this.dir === 0) {
      if (y - this.ext > thr) { this.dir = 1; this.ext = y; }
      else if (this.ext - y > thr) { this.dir = -1; this.ext = y; }
      return null;
    }
    if (this.dir === 1) {
      if (y > this.ext) this.ext = y;
      else if (this.ext - y > thr) { this.dir = -1; this.ext = y; return "bottom"; }
    } else {
      if (y < this.ext) this.ext = y;
      else if (y - this.ext > thr) { this.dir = 1; this.ext = y; return "top"; }
    }
    return null;
  }
}

// Giữ một điều kiện liên tục trong `ms` mili-giây. Trả về tiến độ 0..1.
class Hold {
  constructor(ms) { this.ms = ms; this.since = null; }
  reset() { this.since = null; }
  update(ok, now) {
    if (!ok) { this.since = null; return 0; }
    if (this.since === null) this.since = now;
    return Math.min(1, (now - this.since) / this.ms);
  }
}

// ---------- Một bàn tay đang được theo dõi ----------
// Mỗi track có bộ đếm, neo, và bộ làm mượt riêng. Single/Random dùng 1 track, Double dùng 2.
class HandTrack {
  constructor() { this.detector = new StrokeDetector(); this.count = 0; this.reset(); }
  reset() {
    this.hand = null;        // kết quả analyze của khung gần nhất (giữ lại trong LOST_HAND_MS)
    this.lastAt = 0;
    this.smooth = null;      // toạ độ dọc trục đếm đã làm mượt
    this.curlEma = null;
    this.anchor = null;      // { x, y, size, ux, uy }
    this.onRod = false;
    this.invalidSince = null;
    this.anchorRef = null;   // vị trí lúc bắt đầu giữ yên
    this.axisEma = null;
    this.detector.reset();
  }
  clearMotion() { this.detector.reset(); this.smooth = null; }
  visible(now) { return now - this.lastAt < LOST_HAND_MS; }

  // Mọi khoảng cách quy về đơn vị chiều cao khung hình. z của MediaPipe cùng thang với x.
  analyze(lm, aspect) {
    const P = (i) => [lm[i].x * aspect, lm[i].y, lm[i].z * aspect];
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const wrist = P(0);
    const size = dist(wrist, P(9));
    // Độ duỗi mỗi ngón = (cổ tay→đầu ngón) / (cổ tay→gốc ngón): ~1.9 khi duỗi, ~1 khi co
    // Làm mượt qua các khung để vài khung nhòe không làm đổi trạng thái nắm/xòe
    const raw = FINGERS.map(([tip, mcp]) => dist(P(tip), wrist) / dist(P(mcp), wrist));
    this.curlEma = this.curlEma ? this.curlEma.map((c, i) => c * 0.5 + raw[i] * 0.5) : raw;
    const curls = this.curlEma;
    const extended = curls.filter((c) => c > OPEN_MIN_CURL).length;
    // Trục nắm tay (2D): khớp ngón trỏ → khớp ngón út, chuẩn hoá để hướng "xuống" (y ≥ 0)
    let ux = (lm[17].x - lm[5].x) * aspect, uy = lm[17].y - lm[5].y;
    const len = Math.hypot(ux, uy) || 1;
    ux /= len; uy /= len;
    if (uy < 0 || (uy === 0 && ux < 0)) { ux = -ux; uy = -uy; }
    return {
      lm, size, ux, uy,
      x: PALM_IDS.reduce((s, i) => s + lm[i].x, 0) / PALM_IDS.length,
      y: PALM_IDS.reduce((s, i) => s + lm[i].y, 0) / PALM_IDS.length,
      open: extended === 4,
      // Khi cầm trụ, ngón trỏ thường duỗi hơn các ngón khác nên xét trung bình thay vì từng ngón
      grip: curls.reduce((a, b) => a + b, 0) / curls.length < GRIP_MAX_AVG,
      released: extended >= RELEASE_FINGERS,
    };
  }

  // Toạ độ tay so với trụ: `along` dọc trục (dương = về phía ngón út), `perp` lệch ngang
  rodCoords(h, aspect) {
    const dx = (h.x - this.anchor.x) * aspect;
    const dy = h.y - this.anchor.y;
    return { along: dx * this.anchor.ux + dy * this.anchor.uy, perp: Math.abs(dx * this.anchor.uy - dy * this.anchor.ux) };
  }
  isOnRod(h, aspect) {
    if (!this.anchor || h.released) return false;
    const { along, perp } = this.rodCoords(h, aspect);
    return perp < this.anchor.size * ROD_TOL_X && Math.abs(along) < this.anchor.size * ROD_HALF_LEN;
  }

  // Cập nhật trục tay làm mượt trong lúc giữ yên; lật dấu nếu khung này ngược với trung bình
  accumulateAxis(h) {
    if (!this.axisEma) { this.axisEma = { ux: h.ux, uy: h.uy }; return; }
    const s = h.ux * this.axisEma.ux + h.uy * this.axisEma.uy < 0 ? -1 : 1;
    this.axisEma.ux = this.axisEma.ux * 0.8 + s * h.ux * 0.2;
    this.axisEma.uy = this.axisEma.uy * 0.8 + s * h.uy * 0.2;
  }
  // Tay có đang giữ yên không (so với lúc bắt đầu giữ). Trả về false nếu vừa dịch chuyển.
  updateStill(h, aspect) {
    if (!this.anchorRef || Math.hypot((h.x - this.anchorRef.x) * aspect, h.y - this.anchorRef.y) > h.size * ANCHOR_STILL) {
      this.anchorRef = { x: h.x, y: h.y };
      this.axisEma = null;
      return false;
    }
    return true;
  }
  commitAnchor(h) {
    const a = this.axisEma || { ux: h.ux, uy: h.uy };
    const len = Math.hypot(a.ux, a.uy) || 1;
    this.anchor = { x: h.x, y: h.y, size: h.size, ux: a.ux / len, uy: a.uy / len };
    this.clearMotion();
  }

  // Đưa một mẫu toạ độ vào bộ đếm. Trả về "bottom" (một nhát), "top" hoặc null.
  feed(v, size) {
    this.smooth = this.smooth === null ? v : this.smooth * 0.35 + v * 0.65;
    return this.detector.push(this.smooth, Math.max(0.015, size * STROKE_THR));
  }
}

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const video = $("video");
const overlay = $("overlay");
const octx = overlay.getContext("2d");
const screens = {
  start: $("screen-start"),
  ready: $("screen-ready"),
  anchor: $("screen-ready"),
  countdown: $("screen-countdown"),
  result: $("screen-result"),
  board: $("screen-board"),
};
const hud = $("hud");

// ---------- State ----------
let mode = localStorage.getItem("ambatukam_mode") || "single"; // single | double | random
let duration = 20;
let state = "start";          // start | ready | anchor | countdown | playing | result | board
let input = null;             // "camera" | "keyboard"
let landmarker = null;
let lastVideoTime = -1;
let tracks = [new HandTrack()];
let strokes = [];             // timestamp mọi nhát (để tính tốc độ tức thời)
let count = 0;
let playStart = 0;
let bins = [];                // số nhát theo từng giây
let displayRate = 0;
let framesOnRod = 0;
let framesTotal = 0;
let lastResult = null;        // để vẽ lại màn kết quả khi đổi ngôn ngữ
let session = null;           // Promise<token | null> của ván đang chơi, dùng để nộp điểm
// Random
let meter = 0;                // Lửa (%)
let rodSpawnAt = 0;
let rodsCaught = 0;
let rodHasStroke = false;
let refSize = 0.12;           // cỡ tay đo lúc xòe tay, dùng để vẽ trụ ngẫu nhiên
let lastTick = 0;
const palmHold = new Hold(PALM_HOLD_MS);
const anchorHold = new Hold(ANCHOR_HOLD_MS);

const isTimed = () => mode !== "random";

// ---------- Âm thanh ----------
let audio = null;
function beep(freq, ms = 60, vol = 0.08, type = "square") {
  if (!audio) return;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000);
  o.connect(g).connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + ms / 1000);
}
function say(text) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.9;
  u.pitch = 0.6;
  speechSynthesis.speak(u);
}

// ---------- Ngôn ngữ + chế độ: áp dụng lên DOM ----------
function applyLang() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) el.innerHTML = t(el.dataset.i18n);
  for (const b of $("lang").children) b.classList.toggle("active", b.dataset.lang === lang);
  renderModeTexts();
  if (input === "keyboard" && state === "ready") $("ready-hint").innerHTML = t("kbHint");
  if (lastResult && (state === "result" || state === "board")) renderResult();
  if (state === "board") renderBoard();
}

function renderModeTexts() {
  for (const b of $("modes").children) b.classList.toggle("active", b.dataset.mode === mode);
  $("sub").textContent = t("sub" + mode[0].toUpperCase() + mode.slice(1));
  $("steps").innerHTML = t("steps")[mode].map((s) => `<li>${s}</li>`).join("");
  // Dùng visibility thay vì display để không nhảy layout khi đổi chế độ
  $("durations").classList.toggle("ghost", !isTimed());
  $("btn-keyboard").classList.toggle("ghost", mode !== "single");
  $("power-label").textContent = t(mode === "random" ? "heat" : "power");
  renderBestLine();
}

$("lang").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  lang = b.dataset.lang;
  localStorage.setItem("ambatukam_lang", lang);
  applyLang();
});

$("modes").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]");
  if (!b) return;
  mode = b.dataset.mode;
  localStorage.setItem("ambatukam_mode", mode);
  renderModeTexts();
});

// ---------- Điều hướng màn hình ----------
function show(name) {
  state = name;
  for (const el of new Set(Object.values(screens))) el.classList.toggle("hidden", el !== screens[name]);
  hud.classList.toggle("hidden", name !== "playing");
  palmHold.reset();
  anchorHold.reset();
  setGesture(null);
}

// Thanh hướng dẫn cử chỉ ở đầu khung camera
function setGesture(text, progress = 0) {
  $("gesture").classList.toggle("hidden", !text);
  if (!text) return;
  $("gesture-text").innerHTML = text;
  $("gesture-fill").style.width = (progress * 100).toFixed(0) + "%";
}

function bestKey() { return isTimed() ? `ambatukam_best_${mode}_${duration}` : "ambatukam_best_random"; }
function getBest() { return Number(localStorage.getItem(bestKey()) || 0); }
function renderBestLine() {
  const b = getBest();
  $("best-line").textContent = !b ? "" : isTimed() ? t("bestLine", b, duration) : t("bestLineRandom", b);
}

$("durations").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  duration = Number(btn.dataset.d);
  for (const b of $("durations").children) b.classList.toggle("active", b === btn);
  renderBestLine();
});

function initAudio() {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  audio.resume();
}

function setupTracks() {
  tracks = mode === "double" ? [new HandTrack(), new HandTrack()] : [new HandTrack()];
}

$("btn-start").addEventListener("click", async () => {
  initAudio();
  input = "camera";
  setupTracks();
  show("ready");
  $("btn-go").classList.add("hidden");
  try {
    $("ready-hint").textContent = t("opening");
    await startCamera();
    $("ready-hint").textContent = t("loading");
    if (!landmarker) landmarker = await createLandmarker();
    $("ready-hint").textContent = "";
  } catch (err) {
    console.error(err);
    $("ready-hint").textContent = t("camError", err.message || err);
  }
});

$("btn-keyboard").addEventListener("click", () => {
  initAudio();
  input = "keyboard";
  setupTracks();
  show("ready");
  $("ready-hint").innerHTML = t("kbHint");
  $("btn-go").classList.remove("hidden");
});

$("btn-go").addEventListener("click", startCountdown);
$("btn-again").addEventListener("click", replay);
$("btn-home").addEventListener("click", () => { renderBestLine(); show("start"); });
$("btn-share").addEventListener("click", shareResult);

function replay() {
  if (input === "camera") enterAnchor();
  else startCountdown();
}

// Sau khi "sẵn sàng": single/double sang bước đặt neo; random sinh trụ luôn và đếm ngược
function enterAnchor() {
  for (const tr of tracks) { tr.anchor = null; tr.anchorRef = null; tr.axisEma = null; }
  beep(660, 80, 0.08, "sine");
  if (mode === "random") { spawnRod(); startCountdown(); }
  else show("anchor");
}

// ---------- Camera + mô hình ----------
async function startCamera() {
  if (video.srcObject) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  fitCamera();
}

// Khung hình theo đúng tỉ lệ video (điện thoại cầm dọc trả về video dọc), cập nhật khi xoay máy
function fitCamera() {
  if (!video.videoWidth) return;
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  document.documentElement.style.setProperty("--cam-aspect", String(video.videoWidth / video.videoHeight));
}
video.addEventListener("resize", fitCamera);

async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.4,
    minTrackingConfidence: 0.3,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, opts("GPU"));
  } catch {
    return await HandLandmarker.createFromOptions(fileset, opts("CPU"));
  }
}

// ---------- Gán bàn tay nhận diện được vào từng track ----------
const palmCenter = (lm) => ({
  x: PALM_IDS.reduce((s, i) => s + lm[i].x, 0) / PALM_IDS.length,
  y: PALM_IDS.reduce((s, i) => s + lm[i].y, 0) / PALM_IDS.length,
});

function assignHands(list, aspect) {
  if (!list.length) return tracks.map(() => null);
  const centers = list.map(palmCenter);
  const d = (c, p) => Math.hypot((c.x - p.x) * aspect, c.y - p.y);
  if (tracks.length === 1) {
    // Một track: lấy bàn tay gần vị trí gần nhất (hoặc gần trụ nếu đang chơi random)
    const ref = tracks[0].anchor && mode === "random" ? tracks[0].anchor : tracks[0].hand;
    if (!ref || list.length === 1) return [list[0]];
    let best = 0;
    for (let i = 1; i < list.length; i++) if (d(centers[i], ref) < d(centers[best], ref)) best = i;
    return [list[best]];
  }
  // Hai track: nếu đã có mốc (neo hoặc vị trí cũ) cho cả hai → ghép theo khoảng cách gần nhất
  const refs = tracks.map((tr) => tr.anchor || tr.hand);
  if (refs.every(Boolean)) {
    const pairs = [];
    refs.forEach((r, ti) => centers.forEach((c, ci) => pairs.push({ ti, ci, dist: d(c, r) })));
    pairs.sort((a, b) => a.dist - b.dist);
    const out = [null, null], used = new Set();
    for (const p of pairs) {
      if (out[p.ti] || used.has(p.ci)) continue;
      out[p.ti] = list[p.ci]; used.add(p.ci);
    }
    return out;
  }
  // Chưa có mốc: xếp theo chiều ngang, track 0 = tay bên trái khung (chưa lật gương)
  const order = centers.map((c, i) => i).sort((a, b) => centers[a].x - centers[b].x);
  return [list[order[0]] ?? null, list[order[1]] ?? null];
}

// ---------- Random: sinh trụ ở chỗ mới ----------
function spawnRod() {
  const tr = tracks[0];
  const aspect = overlay.width / overlay.height || 4 / 3;
  const prev = tr.anchor;
  let x, y, tries = 0;
  do {
    x = 0.25 + Math.random() * 0.5;
    y = 0.3 + Math.random() * 0.4;
  } while (prev && Math.hypot((x - prev.x) * aspect, y - prev.y) < RND_MIN_JUMP && ++tries < 20);
  const tilt = ((Math.random() * 2 - 1) * RND_TILT_MAX * Math.PI) / 180;
  tr.anchor = { x, y, size: refSize, ux: Math.sin(tilt), uy: Math.cos(tilt) };
  tr.clearMotion();
  tr.invalidSince = null;
  rodSpawnAt = performance.now();
  rodHasStroke = false;
  beep(990, 60, 0.07, "sine");
  setTimeout(() => beep(1320, 60, 0.07, "sine"), 70);
}
const rodLife = (elapsedSec) => Math.max(RND_ROD_LIFE_MIN, RND_ROD_LIFE_MAX - elapsedSec * RND_ROD_LIFE_STEP);

// ---------- Xử lý một nhát ----------
function onStroke(tr, now) {
  strokes.push(now);
  beep(440 + currentRate(now) * 120, 45, 0.06);
  if (state !== "playing") return;
  count++;
  tr.count++;
  const sec = Math.floor((now - playStart) / 1000);
  if (!isTimed() || sec < duration) {
    while (bins.length <= sec) bins.push(0);
    bins[sec]++;
  }
  if (mode === "random") {
    meter = Math.min(100, meter + RND_STROKE_GAIN);
    if (!rodHasStroke) { rodHasStroke = true; rodsCaught++; }
  }
  $("hud-count").textContent = count;
  if (mode === "double") $("hud-split").textContent = `${tracks[0].count} + ${tracks[1].count}`;
  const el = $("hud-count").parentElement;
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

function currentRate(now) {
  while (strokes.length && now - strokes[0] > RATE_WINDOW_MS) strokes.shift();
  return strokes.length / (RATE_WINDOW_MS / 1000);
}

// ---------- Xử lý một khung hình camera ----------
function processFrame(res, now) {
  const aspect = overlay.width / overlay.height;
  const assigned = assignHands(res.landmarks || [], aspect);
  // Xóc nhanh làm tay nhòe nên mô hình hay mất tay vài khung liền. Trong LOST_HAND_MS
  // vẫn giữ trạng thái tay gần nhất thay vì coi là sai tư thế.
  const seen = tracks.map((tr, i) => {
    const lm = assigned[i];
    if (lm) { tr.hand = tr.analyze(lm, aspect); tr.lastAt = now; return tr.hand; }
    if (!tr.visible(now)) { tr.hand = null; tr.curlEma = null; tr.clearMotion(); }
    return null;
  });
  const hands = tracks.map((tr) => tr.hand);
  const anyOpen = hands.some((h) => h && h.open);

  let progress = 0;
  if (state === "ready" || state === "result") {
    // Đang gõ tên thì không cho xòe tay kích hoạt chơi lại
    const typing = document.activeElement?.tagName === "INPUT";
    progress = palmHold.update(anyOpen && !typing, now);
    const openHand = hands.find((h) => h && h.open);
    if (openHand) refSize = openHand.size;
    setGesture(t(state === "ready" ? "gPalmReady" : "gPalmReplay"), progress);
    if (progress >= 1) { enterAnchor(); return; }
  } else if (state === "anchor") {
    progress = updateAnchorPhase(hands, seen, aspect, now);
    if (progress >= 1) {
      tracks.forEach((tr) => tr.commitAnchor(tr.hand));
      startCountdown();
    }
  } else if (state === "countdown") {
    setGesture(t(mode === "random" ? "gCountdownRandom" : "gCountdown"));
  }

  // Kiểm tra bám trụ khi đang đếm ngược / chơi. Khung không thấy tay thì giữ nguyên kết quả khung trước.
  const active = state === "countdown" || state === "playing";
  tracks.forEach((tr, i) => {
    if (!tr.hand) { tr.onRod = false; return; }
    if (!seen[i] || !active) return;
    tr.onRod = tr.isOnRod(tr.hand, aspect);
    if (tr.onRod) tr.invalidSince = null;
    else if (tr.invalidSince === null) tr.invalidSince = now;
    // Sai tư thế hoặc rời trụ quá lâu → huỷ nhát đang dở, phải xóc lại trọn nhát trên trụ
    if (tr.invalidSince !== null && now - tr.invalidSince > INVALID_GRACE_MS) tr.detector.reset();
  });
  if (state === "playing") {
    framesTotal++;
    if (tracks.every((tr) => tr.onRod)) framesOnRod++;
  }

  // Đưa mẫu vào bộ đếm: có neo thì theo trục trụ, chưa có thì theo chiều dọc màn hình
  tracks.forEach((tr, i) => {
    const h = seen[i];
    if (!h) return;
    const rev = tr.anchor ? tr.feed(tr.rodCoords(h, aspect).along, tr.anchor.size) : tr.feed(h.y, h.size);
    if (rev === "bottom") onStroke(tr, now);
    else if (rev === "top") beep(330, 30, 0.03);
  });
  draw(seen, progress);
}

// Bước đặt neo: mọi tay phải nắm, ở trong vùng cho phép, và giữ yên cùng lúc
function updateAnchorPhase(hands, seen, aspect, now) {
  const need = tracks.length;
  const present = hands.filter(Boolean);
  const zoneX = need === 2 ? DOUBLE_ZONE_X : ANCHOR_ZONE_X;
  const inZone = (h) => Math.abs(h.x - 0.5) < zoneX && Math.abs(h.y - 0.5) < ANCHOR_ZONE_Y;
  let ok = present.length === need && present.every((h) => h.grip && inZone(h));
  let apart = true;
  if (ok && need === 2) {
    const [a, b] = hands;
    apart = Math.hypot((a.x - b.x) * aspect, a.y - b.y) > HAND_MIN_GAP * Math.max(a.size, b.size);
    ok = apart;
  }
  if (ok) {
    tracks.forEach((tr, i) => { if (!tr.updateStill(tr.hand, aspect)) anchorHold.reset(); if (seen[i]) tr.accumulateAxis(seen[i]); });
  } else {
    tracks.forEach((tr) => { tr.anchorRef = null; tr.axisEma = null; });
  }
  const progress = anchorHold.update(ok, now);
  let msg;
  if (present.length < need) msg = need === 2 ? "gTwoHands" : "gGrip";
  else if (!present.every((h) => h.grip)) msg = need === 2 ? "gGripBoth" : "gGrip";
  else if (!present.every(inZone)) msg = "gCenter";
  else if (!apart) msg = "gApart";
  else msg = "gHold";
  setGesture(t(msg), progress);
  return progress;
}

// ---------- Vẽ lớp phủ ----------
function draw(seen, progress) {
  const w = overlay.width, h = overlay.height;
  octx.clearRect(0, 0, w, h);
  const active = state === "countdown" || state === "playing";

  for (const tr of tracks) {
    if (!tr.anchor || !active) continue;
    const a = tr.anchor;
    const half = a.size * ROD_HALF_LEN * h;
    const tol = a.size * ROD_TOL_X * h;
    // Trắng: đúng trụ · Đỏ: buông tay / lệch trụ · Xám: mất dấu tay
    const color = !tr.hand ? "#8b8b8b" : tr.onRod ? "#f2f2f2" : "#ff3b3b";
    // Vẽ trong hệ toạ độ của trụ: gốc tại điểm neo, trục y cục bộ trùng trục trụ
    octx.save();
    octx.translate(a.x * w, a.y * h);
    octx.rotate(Math.atan2(a.uy, a.ux) - Math.PI / 2);
    // Vùng hợp lệ: viền nét đứt mảnh
    octx.strokeStyle = color;
    octx.globalAlpha = 0.5;
    octx.setLineDash([4, 6]);
    octx.lineWidth = 1.5;
    octx.beginPath();
    octx.roundRect(-tol, -half, tol * 2, half * 2, tol);
    octx.stroke();
    octx.setLineDash([]);
    // Thanh trụ: một khối đặc
    const rodW = a.size * 0.3 * h;
    octx.globalAlpha = 0.85;
    octx.fillStyle = color;
    octx.beginPath();
    octx.roundRect(-rodW / 2, -half, rodW, half * 2, rodW / 2);
    octx.fill();
    // Điểm neo: vạch cắt ngang trụ
    octx.globalAlpha = 1;
    octx.fillStyle = "#0b0b0b";
    octx.fillRect(-rodW / 2, -1.5, rodW, 3);
    octx.restore();
    // Random: vòng lan toả khi trụ vừa xuất hiện
    if (mode === "random") {
      const age = (performance.now() - rodSpawnAt) / 500;
      if (age < 1) {
        octx.globalAlpha = 1 - age;
        octx.lineWidth = 2;
        octx.strokeStyle = "#f2f2f2";
        octx.beginPath();
        octx.arc(a.x * w, a.y * h, (0.5 + age * 2) * half, 0, Math.PI * 2);
        octx.stroke();
        octx.globalAlpha = 1;
      }
    }
  }

  seen.forEach((hd) => {
    if (!hd) return;
    octx.globalAlpha = 0.9;
    octx.fillStyle = hd.released ? "#ff3b3b" : "#f2f2f2";
    for (const p of hd.lm) {
      octx.beginPath();
      octx.arc(p.x * w, p.y * h, 2.5, 0, Math.PI * 2);
      octx.fill();
    }
    octx.globalAlpha = 1;
    // Vòng tiến độ cử chỉ quanh lòng bàn tay
    if (progress > 0) {
      const r = hd.size * 0.9 * h;
      octx.lineWidth = 3;
      octx.strokeStyle = "rgba(242,242,242,.25)";
      octx.beginPath();
      octx.arc(hd.x * w, hd.y * h, r, 0, Math.PI * 2);
      octx.stroke();
      octx.strokeStyle = "#f2f2f2";
      octx.beginPath();
      octx.arc(hd.x * w, hd.y * h, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      octx.stroke();
    }
  });
}

// ---------- Chế độ phím / chạm (chỉ single) ----------
const KEY_Y = { ArrowUp: 0.3, KeyW: 0.3, ArrowDown: 0.7, KeyS: 0.7 };
function keyboardSample(y) {
  const now = performance.now();
  const tr = tracks[0];
  tr.lastAt = now;
  const rev = tr.feed(y, 0.2);
  if (rev === "bottom") onStroke(tr, now);
}
window.addEventListener("keydown", (e) => {
  if (input !== "keyboard" || !(e.code in KEY_Y) || e.target.tagName === "INPUT") return;
  e.preventDefault();
  if (e.repeat) return;
  keyboardSample(KEY_Y[e.code]);
});
document.querySelector(".cam-wrap").addEventListener("pointerdown", (e) => {
  if (input !== "keyboard" || (state !== "playing" && state !== "countdown")) return;
  const r = e.currentTarget.getBoundingClientRect();
  keyboardSample((e.clientY - r.top) / r.height < 0.5 ? 0.3 : 0.7);
});

// ---------- Vòng chơi ----------
function startCountdown() {
  show("countdown");
  beep(880, 120, 0.08, "sine");
  const el = $("countdown");
  const steps = ["3", "2", "1", "GO"];
  steps.forEach((s, i) => {
    setTimeout(() => {
      el.textContent = s;
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "";
      beep(i < 3 ? 520 : 880, i < 3 ? 120 : 250, 0.1, "sine");
      if (i === steps.length - 1) setTimeout(startPlaying, 400);
    }, i * 800);
  });
}

function startPlaying() {
  count = 0;
  for (const tr of tracks) tr.count = 0;
  bins = isTimed() ? new Array(duration).fill(0) : [];
  strokes = [];
  framesOnRod = 0;
  framesTotal = 0;
  meter = RND_METER_START;
  rodsCaught = 0;
  rodHasStroke = false;
  playStart = performance.now();
  lastTick = playStart;
  session = input === "camera" ? requestSession() : null;
  if (mode === "random") rodSpawnAt = playStart;
  $("hud-count").textContent = "0";
  $("hud-split").textContent = mode === "double" ? "0 + 0" : "";
  show("playing");
}

function tierIndex(mins, v) { return mins.filter((m) => v >= m).length - 1; }

function finish() {
  show("result");
  beep(220, 400, 0.1, "sawtooth");
  const elapsed = (performance.now() - playStart) / 1000;
  const prev = getBest();
  // Random: đệm đủ số giây đã chơi để biểu đồ và đỉnh tính đúng
  if (!isTimed()) while (bins.length < Math.ceil(elapsed)) bins.push(0);
  let r;
  if (isTimed()) {
    const avg = count / duration;
    r = {
      hero: avg.toFixed(2), score: count, avg,
      tier: tierIndex(TIER_MIN, mode === "double" ? avg / 2 : avg),
      stats: [[t("total"), mode === "double" ? `${tracks[0].count} + ${tracks[1].count}` : count], [t("peak"), Math.max(0, ...bins)]],
      gripPct: input === "camera" && framesTotal ? Math.round((framesOnRod / framesTotal) * 100) : null,
    };
    if (r.gripPct !== null) r.stats.push([t("gripLabel"), `${r.gripPct}%`]);
  } else {
    const survived = Math.round(elapsed * 10) / 10;
    r = {
      hero: survived.toFixed(1), score: survived, survived,
      tier: tierIndex(RND_TIER_SEC, survived),
      stats: [[t("total"), count], [t("rods"), rodsCaught], [t("peak"), Math.max(0, ...bins)]],
    };
  }
  r.count = count; r.duration = duration; r.bins = [...bins]; r.peak = Math.max(0, ...bins);
  r.rods = rodsCaught; r.prevBest = prev; r.mode = mode;
  if (r.score > prev) localStorage.setItem(bestKey(), String(r.score));
  r.session = session;
  r.submit = input !== "camera" ? { status: "off", msg: "noRankKb" } : r.score > 0 ? { status: "form" } : { status: "off", msg: "noRankZero" };
  $("name-input").value = localStorage.getItem("ambatukam_name") || "";
  lastResult = r;
  renderResult();
  // Đã có tên từ lần trước thì tự gửi luôn
  if (r.submit.status === "form" && $("name-input").value) submitScore();
  if (r.tier >= 3) say("Ambatukam!");
}

function renderResult() {
  const r = lastResult;
  const [title, note] = t("tiers")[r.tier];
  $("res-hero").textContent = r.hero;
  $("res-unit").textContent = t(isTimed() ? "avg" : "survived");
  $("res-title").textContent = title;
  $("res-note").textContent = note;
  // Nhãn thống kê phụ thuộc ngôn ngữ: dựng lại từ dữ liệu thô
  const stats = isTimed()
    ? [[t("total"), r.mode === "double" ? `${tracks[0].count} + ${tracks[1].count}` : r.count], [t("peak"), r.peak]]
    : [[t("total"), r.count], [t("rods"), r.rods], [t("peak"), r.peak]];
  if (isTimed() && r.gripPct !== null) stats.push([t("gripLabel"), `${r.gripPct}%`]);
  [1, 2, 3].forEach((i) => {
    const s = stats[i - 1];
    $(`res-l${i}`).textContent = s ? s[0] : "";
    $(`res-s${i}`).textContent = s ? s[1] : "";
  });
  $("res-w3").classList.toggle("hidden", stats.length < 3);
  const isNew = r.score > r.prevBest;
  $("res-best").textContent = isNew
    ? (r.prevBest ? t("newBest", r.prevBest) : t("firstBest"))
    : (isTimed() ? t("bestShort", r.prevBest, r.duration) : t("bestShortRandom", r.prevBest));
  drawChart($("res-chart"), r.bins, r.peak);
  renderSubmit();
}

function drawChart(canvas, data, peak) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height, pad = 16, top = 22;
  ctx.clearRect(0, 0, w, h);
  const n = Math.max(1, data.length);
  const max = Math.max(MAX_RATE, ...data);
  const bw = (w - pad * 2) / n;
  for (let i = 0; i < n; i++) {
    const v = data[i] || 0;
    const bh = (v / max) * (h - pad - top);
    ctx.fillStyle = v === peak && v > 0 ? "#ff3b3b" : "#555";
    ctx.fillRect(pad + i * bw + 1, h - pad - bh, Math.max(1, bw - 2), bh);
  }
  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(pad, h - pad, w - pad * 2, 1);
  ctx.fillStyle = "#8b8b8b";
  ctx.font = "11px system-ui";
  ctx.fillText(t("chartLabel").toUpperCase(), pad, 12);
  ctx.fillText("0s", pad, h - 3);
  ctx.textAlign = "right";
  ctx.fillText(`${n}s`, w - pad, h - 3);
  ctx.textAlign = "left";
}

// ---------- Bảng xếp hạng ----------
async function api(path, body) {
  const res = await fetch(API_URL + path, body && {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || String(res.status));
  return data;
}

// Mã người chơi ẩn danh: mỗi máy giữ một dòng điểm cao nhất trên bảng
function playerId() {
  let id = localStorage.getItem("ambatukam_pid");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("ambatukam_pid", id); }
  return id;
}

// Server ghi lại lúc bắt đầu ván để đối chiếu thời lượng khi nộp điểm
function requestSession() {
  return api("/api/session", { mode, duration: isTimed() ? duration : 0 }).then((d) => d.token, () => null);
}

async function submitScore() {
  const r = lastResult;
  const name = $("name-input").value.trim();
  if (!name) { $("name-input").focus(); return; }
  localStorage.setItem("ambatukam_name", name);
  $("name-input").blur();
  r.submit = { status: "sending" };
  renderSubmit();
  try {
    const token = await r.session;
    if (!token) throw new Error("no_session");
    const res = await api("/api/score", {
      token, pid: playerId(), name, strokes: r.count,
      survived: r.mode === "random" ? r.score : undefined,
    });
    r.submit = { status: "done", ...res };
  } catch (err) {
    r.submit = ["too_fast", "implausible", "bad_score"].includes(err.message)
      ? { status: "off", msg: "submitRejected" }
      : { status: "error", msg: "submitErr" };
  }
  if (lastResult === r) renderSubmit();
}

function renderSubmit() {
  const s = lastResult.submit;
  $("submit-form").classList.toggle("hidden", s.status !== "form" && s.status !== "error");
  $("btn-rename").classList.toggle("hidden", s.status !== "done");
  $("name-input").placeholder = t("namePh");
  $("submit-msg").textContent =
    s.status === "sending" ? t("submitting")
    : s.status === "done" ? t("rankLine", s.name, s.rank, s.total)
    : s.msg ? t(s.msg) : "";
}

$("submit-form").addEventListener("submit", (e) => { e.preventDefault(); submitScore(); });
$("btn-rename").addEventListener("click", () => {
  lastResult.submit = { status: "form" };
  renderSubmit();
  $("name-input").focus();
  $("name-input").select();
});

let boardMode = "single";
let boardDuration = 20;
let boardBack = "start";      // màn hình quay về khi bấm "Quay lại"
let boardData = null;         // null = đang tải, "error", hoặc { entries, me }
let boardReq = 0;             // bỏ qua kết quả của request cũ khi đã đổi tab

function openBoard() {
  boardBack = state;
  boardMode = mode;
  if (isTimed()) boardDuration = duration;
  show("board");
  loadBoard();
}

function loadBoard() {
  for (const b of $("board-modes").children) b.classList.toggle("active", b.dataset.mode === boardMode);
  for (const b of $("board-durations").children) b.classList.toggle("active", Number(b.dataset.d) === boardDuration);
  $("board-durations").classList.toggle("ghost", boardMode === "random");
  boardData = null;
  renderBoard();
  const req = ++boardReq;
  const d = boardMode === "random" ? 0 : boardDuration;
  api(`/api/leaderboard?mode=${boardMode}&duration=${d}&pid=${playerId()}`)
    .catch(() => "error")
    .then((data) => { if (req === boardReq) { boardData = data; renderBoard(); } });
}

// Single/double xếp theo tổng nhát nhưng hiển thị nhát/giây; random theo giây sống sót
function boardScore(score) {
  return boardMode === "random" ? `${score.toFixed(1)}s` : `${(score / boardDuration).toFixed(2)}/s`;
}

function renderBoard() {
  const list = $("board-list");
  const d = boardData;
  const row = (cls, cells) => {
    const li = document.createElement("li");
    if (cls) li.className = cls;
    for (const [c, text] of cells) {
      const span = document.createElement("span");
      span.className = c;
      span.textContent = text;
      li.append(span);
    }
    return li;
  };
  if (!d || d === "error" || !d.entries.length) {
    list.replaceChildren(row("note", [["", t(!d ? "boardLoading" : d === "error" ? "boardErr" : "boardEmpty")]]));
    $("board-msg").textContent = "";
    return;
  }
  list.replaceChildren(...d.entries.map((e, i) =>
    row(e.me ? "me" : "", [["rk", i + 1], ["nm", e.name], ["sc", boardScore(e.score)], ["ct", t("strokesN", e.strokes)]])));
  $("board-msg").textContent = d.me && !d.entries.some((e) => e.me) ? t("boardMe", d.me.rank, d.me.total, boardScore(d.me.score)) : "";
}

$("btn-board-start").addEventListener("click", openBoard);
$("btn-board-result").addEventListener("click", openBoard);
$("btn-board-back").addEventListener("click", () => show(boardBack));
$("board-modes").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  boardMode = b.dataset.mode;
  loadBoard();
});
$("board-durations").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  boardDuration = Number(b.dataset.d);
  loadBoard();
});

// ---------- Chia sẻ ----------
async function shareResult() {
  const r = lastResult;
  const [title] = t("tiers")[r.tier];
  const c = document.createElement("canvas");
  c.width = 1080; c.height = 1080;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0b0b0b";
  ctx.fillRect(0, 0, 1080, 1080);
  ctx.fillStyle = "#ff3b3b";
  ctx.fillRect(80, 96, 28, 28);
  ctx.fillStyle = "#f2f2f2";
  ctx.font = "800 40px system-ui";
  ctx.fillText(`AMBATUKAM · ${t("mode" + r.mode[0].toUpperCase() + r.mode.slice(1)).toUpperCase()}`, 130, 124);
  ctx.font = "700 260px ui-monospace, Menlo, monospace";
  ctx.fillText(r.hero, 80, 480);
  ctx.fillStyle = "#8b8b8b";
  ctx.font = "32px system-ui";
  ctx.fillText(t(isTimed() ? "avg" : "survived").toUpperCase(), 84, 540);
  ctx.fillStyle = "#f2f2f2";
  ctx.font = "800 72px system-ui";
  ctx.fillText(title, 80, 680);
  ctx.fillStyle = "#8b8b8b";
  ctx.font = "36px system-ui";
  ctx.fillText(isTimed() ? t("shareSub", r.count, r.duration, r.peak) : t("shareSubRandom", r.count, r.rods), 80, 740);
  ctx.drawImage($("res-chart"), 80, 800, 920, 180);
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  const file = new File([blob], "ambatukam-score.png", { type: "image/png" });
  const text = isTimed() ? t("shareText", r.hero) : t("shareTextRandom", r.hero);
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Ambatukam Game", text }); return; } catch {}
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Main loop ----------
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();

  if (input === "camera" && landmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    processFrame(landmarker.detectForVideo(video, now), now);
  }

  // Random: Lửa cạn dần, trụ đổi chỗ
  if (state === "playing" && mode === "random") {
    const elapsed = (now - playStart) / 1000;
    const dt = (now - lastTick) / 1000;
    meter -= (RND_DRAIN_BASE + RND_DRAIN_RAMP * elapsed) * dt;
    if (now - rodSpawnAt > rodLife(elapsed)) spawnRod();
    if (meter <= 0) { meter = 0; finish(); }
  }
  lastTick = now;

  // Thanh bên: lực (nhát/giây) hoặc Lửa (random)
  const rate = currentRate(now);
  displayRate += (rate - displayRate) * 0.2;
  const pct = mode === "random" && (state === "playing" || state === "result") ? meter / 100 : Math.min(1, displayRate / MAX_RATE);
  const fill = $("power-fill");
  fill.style.height = (pct * 100).toFixed(1) + "%";
  fill.style.setProperty("--pct", (pct * 100).toFixed(1) + "%"); // bản mobile nằm ngang
  $("power-bar").classList.toggle("maxed", mode !== "random" && pct > 0.95);
  $("power-bar").classList.toggle("low", mode === "random" && state === "playing" && pct < 0.3);
  const showHeat = mode === "random" && (state === "playing" || state === "result");
  $("power-value").textContent = showHeat ? Math.round(meter) : displayRate.toFixed(1);
  $("power-unit").textContent = showHeat ? "%" : t("perSec");
  const tr = tracks[0];
  const marker = $("power-hand");
  const visible = tracks.length === 1 && tr.smooth !== null && tr.visible(now);
  marker.classList.toggle("on", visible);
  if (visible) {
    // Có neo: smooth là vị trí dọc trụ (−half..half) → quy về 0..1 theo chiều dài trụ
    const pos = tr.anchor && input === "camera" ? 0.5 + tr.smooth / (2 * tr.anchor.size * ROD_HALF_LEN) : tr.smooth;
    marker.style.top = `calc(${(Math.min(1, Math.max(0, pos)) * 100).toFixed(1)}% - 1px)`;
  }

  if (state === "playing") {
    const elapsed = (now - playStart) / 1000;
    const left = Math.max(0, duration - elapsed);
    $("hud-time").textContent = (isTimed() ? left : elapsed).toFixed(1);
    let status = "";
    if (input === "camera") {
      const missing = tracks.filter((x) => !x.hand).length;
      if (missing === tracks.length) status = t("sLost");
      else if (missing) status = t("sOneHand");
      else if (tracks.some((x) => x.hand.released)) status = t("sGrip");
      else if (tracks.some((x) => !x.onRod)) status = t(mode === "random" ? "sGoRod" : "sAnchor");
    }
    $("hud-status").textContent = status;
    if (isTimed() && left <= 0) finish();
  }
}

// Hook để test logic bằng dữ liệu tay giả: mở trang với ?debug
// Thêm &auto=result|play&mode=single|double|random&lang=vi để nhảy thẳng tới một màn hình.
const params = new URLSearchParams(location.search);
if (params.has("debug")) {
  window.__amb = {
    processFrame,
    useFakeCamera() { input = "camera"; setupTracks(); overlay.width = 640; overlay.height = 480; show("ready"); },
    setMode(m) { mode = m; renderModeTexts(); },
    get state() { return state; },
    get count() { return count; },
    get counts() { return tracks.map((x) => x.count); },
    get anchors() { return tracks.map((x) => x.anchor); },
    get onRod() { return tracks.map((x) => x.onRod); },
    get meter() { return meter; },
    get rods() { return rodsCaught; },
  };
  if (params.get("lang")) lang = params.get("lang");
  if (params.get("mode")) mode = params.get("mode");
  const auto = params.get("auto");
  if (auto) {
    window.__amb.useFakeCamera();
    duration = 10;
    // Tay nắm giả: cổ tay bên trái, các khớp xếp dọc theo trục trụ nghiêng `tilt`
    const fakeHand = (cx, cy, tilt) => {
      const aspect = overlay.width / overlay.height;
      const rot = (dx, dy) => ({ x: cx + (dx * Math.cos(tilt) - dy * Math.sin(tilt)) / aspect, y: cy + dx * Math.sin(tilt) + dy * Math.cos(tilt), z: 0 });
      const lm = Array.from({ length: 21 }, () => rot(0, 0));
      lm[0] = rot(-0.08, 0);
      [[5, -0.05, 8], [9, -0.015, 12], [13, 0.02, 16], [17, 0.055, 20]].forEach(([m, dy, tip]) => {
        lm[m] = rot(0.06, dy);
        lm[tip] = rot(0.06 + 0.014, dy);
      });
      return lm;
    };
    const tilts = mode === "double" ? [-0.35, 0.35] : [0.44];
    const xs = mode === "double" ? [0.3, 0.7] : [0.5];
    tracks.forEach((tr, i) => { tr.anchor = { x: xs[i], y: 0.5, size: 0.14, ux: Math.sin(tilts[i]), uy: Math.cos(tilts[i]) }; });
    if (auto === "play") {
      startPlaying();
      count = 12; $("hud-count").textContent = count;
      if (mode === "double") { tracks[0].count = 5; tracks[1].count = 7; $("hud-split").textContent = "5 + 7"; }
      if (mode === "random") { meter = 62; rodSpawnAt = performance.now() - 1000; }
      for (let i = 0; i < 6; i++) strokes.push(performance.now() - i * 200);
      processFrame({ landmarks: tracks.map((tr, i) => fakeHand(xs[i], 0.5, tilts[i])) }, performance.now());
    } else {
      count = 39; bins = [3, 4, 4, 5, 4, 4, 4, 4, 4, 3]; framesTotal = 100; framesOnRod = 82;
      if (mode === "double") { tracks[0].count = 19; tracks[1].count = 20; }
      if (mode === "random") { rodsCaught = 6; playStart = performance.now() - 23400; }
      finish();
    }
  }
}

// Màn cảm ứng: chế độ không camera chơi bằng cách chạm nửa trên / nửa dưới
if (matchMedia("(pointer: coarse)").matches) $("btn-keyboard").dataset.i18n = "keyboardTouch";
applyLang();
requestAnimationFrame(loop);
