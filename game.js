// Ambatukam Game — MVP
// Đếm số nhát xóc lên-xuống quanh một "thanh trụ ảo" tại điểm neo, trong thời gian cố định.
// Nhận diện tay bằng MediaPipe Hand Landmarker, chạy hoàn toàn trong trình duyệt.
import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

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
const ANCHOR_ZONE_X = 0.25;   // điểm neo phải cách tâm khung hình (ngang) không quá 25%
const ANCHOR_ZONE_Y = 0.3;
const TIER_MIN = [0, 1, 2, 3, 4, 5]; // ngưỡng nhát/giây của từng danh hiệu

const PALM_IDS = [0, 5, 9, 13, 17];
const FINGERS = [[8, 5], [12, 9], [16, 13], [20, 17]]; // [đầu ngón, gốc ngón]

// ---------- Ngôn ngữ ----------
const STRINGS = {
  vi: {
    title: "Ambatukam Challenge",
    sub: "Nắm tay như cầm một thanh trụ, xóc lên xuống thật nhanh trước camera. Hết giờ, máy tính tốc độ trung bình của bạn.",
    start: "Bật camera & chơi",
    keyboard: "Không có camera? Chơi bằng phím ↑ ↓",
    fine: "Game meme giải trí, 16+. Không có hình ảnh nhạy cảm. Video không rời khỏi máy bạn.",
    bestLine: (n, d) => `Kỷ lục ${d}s: ${n} nhát · ${(n / d).toFixed(2)} nhát/s`,
    step1: "<b>Xòe tay</b>, giữ 1 giây = sẵn sàng",
    step2: "<b>Nắm tay như cầm trụ</b>, giữ yên 1 giây = đặt điểm neo. Trụ nghiêng theo hướng tay bạn",
    step3: "Xóc <b>lên xuống dọc trụ</b>. Lệch trụ hoặc xòe tay thì không tính",
    go: "Sẵn sàng",
    opening: "Đang mở camera…",
    loading: "Đang tải mô hình nhận diện tay…",
    camError: (m) => `Không mở được camera: ${m}. Thử chế độ phím.`,
    kbHint: "Chế độ phím: bấm <b>↑</b> và <b>↓</b> luân phiên, hoặc chạm nửa trên / nửa dưới khung hình.",
    gPalmReady: "✋ Xòe tay, giữ 1 giây để <b>sẵn sàng</b>",
    gPalmReplay: "✋ Xòe tay, giữ 1 giây để <b>chơi lại</b>",
    gGrip: "✊ Nắm tay như đang <b>cầm một thanh trụ</b>",
    gCenter: "Đưa tay vào <b>gần giữa khung hình</b>",
    gHold: "Giữ yên để đặt <b>điểm neo</b>",
    gCountdown: "Giữ tay trên trụ, chuẩn bị…",
    strokes: "nhát",
    power: "Lực",
    perSec: "nhát/s",
    sLost: "Mất dấu tay. Thêm ánh sáng sẽ đỡ nhòe",
    sGrip: "Nắm tay lại",
    sAnchor: "Quay lại điểm neo",
    avg: "nhát / giây trung bình",
    total: "tổng nhát",
    peak: "đỉnh / giây",
    gripLabel: "bám trụ",
    newBest: (prev) => `Kỷ lục mới · cũ ${prev}`,
    firstBest: "Kỷ lục đầu tiên",
    bestShort: (n, d) => `Kỷ lục ${d}s: ${n} nhát`,
    again: "Chơi lại",
    share: "Lưu ảnh",
    home: "Đổi thời gian",
    chartLabel: "nhát mỗi giây",
    shareText: (r) => `Tôi đạt ${r} nhát/s trong Ambatukam Game`,
    shareSub: (n, d, p) => `${n} nhát trong ${d}s · đỉnh ${p}/s`,
    footer: "Lấy cảm hứng từ trend “67 speed”. Nhận diện tay bằng MediaPipe, chạy local trong trình duyệt.",
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
    sub: "Grip like you're holding a rod, then stroke up and down as fast as you can. When time's up, we score your average speed.",
    start: "Turn on camera & play",
    keyboard: "No camera? Play with ↑ ↓ keys",
    fine: "Meme game for fun, 16+. No explicit imagery. Video never leaves your device.",
    bestLine: (n, d) => `Best ${d}s: ${n} strokes · ${(n / d).toFixed(2)}/s`,
    step1: "<b>Open palm</b>, hold 1s = ready",
    step2: "<b>Grip like holding a rod</b>, hold still 1s = set anchor. The rod tilts to match your hand",
    step3: "Stroke <b>up and down along the rod</b>. Drifting off or opening your hand doesn't count",
    go: "Ready",
    opening: "Opening camera…",
    loading: "Loading hand-tracking model…",
    camError: (m) => `Couldn't open camera: ${m}. Try keyboard mode.`,
    kbHint: "Keyboard mode: alternate <b>↑</b> and <b>↓</b>, or tap the top / bottom half of the frame.",
    gPalmReady: "✋ Open palm, hold 1s to get <b>ready</b>",
    gPalmReplay: "✋ Open palm, hold 1s to <b>play again</b>",
    gGrip: "✊ Grip like you're <b>holding a rod</b>",
    gCenter: "Move your hand <b>closer to the center</b>",
    gHold: "Hold still to set the <b>anchor</b>",
    gCountdown: "Keep your hand on the rod, get set…",
    strokes: "strokes",
    power: "Power",
    perSec: "per sec",
    sLost: "Lost your hand. More light reduces blur",
    sGrip: "Grip again",
    sAnchor: "Back to the anchor",
    avg: "strokes / sec average",
    total: "total strokes",
    peak: "peak / sec",
    gripLabel: "on rod",
    newBest: (prev) => `New best · was ${prev}`,
    firstBest: "First record",
    bestShort: (n, d) => `Best ${d}s: ${n} strokes`,
    again: "Play again",
    share: "Save image",
    home: "Change time",
    chartLabel: "strokes per second",
    shareText: (r) => `I hit ${r} strokes/s in Ambatukam Game`,
    shareSub: (n, d, p) => `${n} strokes in ${d}s · peak ${p}/s`,
    footer: "Inspired by the “67 speed” trend. Hand tracking by MediaPipe, running locally in your browser.",
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
};
const hud = $("hud");

// ---------- State ----------
let duration = 20;
let state = "start";          // start | ready | anchor | countdown | playing | result
let input = null;             // "camera" | "keyboard"
let landmarker = null;
let lastVideoTime = -1;
let lastHandAt = 0;
let hand = null;              // kết quả analyzeHand của khung gần nhất
let smoothY = null;
let strokes = [];             // timestamp mọi nhát (để tính tốc độ tức thời)
let count = 0;
let playStart = 0;
let bins = [];                // số nhát theo từng giây
let displayRate = 0;
let anchor = null;            // { x, y, size, ux, uy } — điểm neo + vector đơn vị trục trụ
let axisEma = null;           // trục tay làm mượt trong lúc giữ yên đặt neo
let onRod = false;            // khung hiện tại: tay đang nắm đúng trên trụ
let invalidSince = null;
let framesOnRod = 0;
let framesTotal = 0;
let anchorRef = null;         // vị trí tay lúc bắt đầu giữ yên để đặt neo
let curlEma = null;           // độ duỗi ngón đã làm mượt qua các khung hình
let lastResult = null;        // để vẽ lại màn kết quả khi đổi ngôn ngữ
const detector = new StrokeDetector();
const palmHold = new Hold(PALM_HOLD_MS);
const anchorHold = new Hold(ANCHOR_HOLD_MS);

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

// ---------- Ngôn ngữ: áp dụng lên DOM ----------
function applyLang() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) el.innerHTML = t(el.dataset.i18n);
  for (const b of $("lang").children) b.classList.toggle("active", b.dataset.lang === lang);
  renderBestLine();
  if (input === "keyboard" && state === "ready") $("ready-hint").innerHTML = t("kbHint");
  if (state === "result" && lastResult) renderResult();
}

$("lang").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  lang = b.dataset.lang;
  localStorage.setItem("ambatukam_lang", lang);
  applyLang();
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

function bestKey() { return `ambatukam_best_${duration}`; }
function getBest() { return Number(localStorage.getItem(bestKey()) || 0); }
function renderBestLine() {
  const b = getBest();
  $("best-line").textContent = b ? t("bestLine", b, duration) : "";
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

$("btn-start").addEventListener("click", async () => {
  initAudio();
  input = "camera";
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
  anchor = null;
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

function enterAnchor() {
  anchor = null;
  anchorRef = null;
  show("anchor");
  beep(660, 80, 0.08, "sine");
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
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
}

async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: 1,
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

function handVisible() { return performance.now() - lastHandAt < LOST_HAND_MS; }

// ---------- Phân tích tư thế tay ----------
// Mọi khoảng cách quy về đơn vị chiều cao khung hình. z của MediaPipe cùng thang với x.
function analyzeHand(lm, aspect) {
  const P = (i) => [lm[i].x * aspect, lm[i].y, lm[i].z * aspect];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const wrist = P(0);
  const size = dist(wrist, P(9));
  // Độ duỗi mỗi ngón = (cổ tay→đầu ngón) / (cổ tay→gốc ngón): ~1.9 khi duỗi, ~1 khi co
  // Làm mượt qua các khung để vài khung nhòe không làm đổi trạng thái nắm/xòe
  const raw = FINGERS.map(([tip, mcp]) => dist(P(tip), wrist) / dist(P(mcp), wrist));
  curlEma = curlEma ? curlEma.map((c, i) => c * 0.5 + raw[i] * 0.5) : raw;
  const curls = curlEma;
  const extended = curls.filter((c) => c > OPEN_MIN_CURL).length;
  // Trục nắm tay (2D): khớp ngón trỏ → khớp ngón út, chuẩn hoá để hướng "xuống" (y ≥ 0)
  let ux = (lm[17].x - lm[5].x) * aspect, uy = lm[17].y - lm[5].y;
  const len = Math.hypot(ux, uy) || 1;
  ux /= len; uy /= len;
  if (uy < 0 || (uy === 0 && ux < 0)) { ux = -ux; uy = -uy; }
  return {
    lm,
    size,
    ux, uy,
    x: PALM_IDS.reduce((s, i) => s + lm[i].x, 0) / PALM_IDS.length,
    y: PALM_IDS.reduce((s, i) => s + lm[i].y, 0) / PALM_IDS.length,
    open: extended === 4,
    // Khi cầm trụ, ngón trỏ thường duỗi hơn các ngón khác nên xét trung bình thay vì từng ngón
    grip: curls.reduce((a, b) => a + b, 0) / curls.length < GRIP_MAX_AVG,
    released: extended >= RELEASE_FINGERS,
  };
}

// Toạ độ tay so với trụ: `along` dọc trục (dương = về phía ngón út), `perp` lệch ngang
function rodCoords(h, aspect) {
  const dx = (h.x - anchor.x) * aspect;
  const dy = h.y - anchor.y;
  return { along: dx * anchor.ux + dy * anchor.uy, perp: Math.abs(dx * anchor.uy - dy * anchor.ux) };
}

function isOnRod(h, aspect) {
  if (!anchor || h.released) return false;
  const { along, perp } = rodCoords(h, aspect);
  return perp < anchor.size * ROD_TOL_X && Math.abs(along) < anchor.size * ROD_HALF_LEN;
}

// ---------- Xử lý mẫu ----------
// `y` là toạ độ dọc trục đếm: trước khi có neo là y màn hình, có neo rồi là vị trí dọc trục trụ
function feedSample(y, size, now) {
  smoothY = smoothY === null ? y : smoothY * 0.35 + y * 0.65;
  const rev = detector.push(smoothY, Math.max(0.015, size * STROKE_THR));
  if (rev === "bottom") onStroke(now);
  else if (rev === "top") beep(330, 30, 0.03);
}

function onStroke(now) {
  strokes.push(now);
  beep(440 + currentRate(now) * 120, 45, 0.06);
  if (state !== "playing") return;
  count++;
  const sec = Math.floor((now - playStart) / 1000);
  if (sec < duration) bins[sec] = (bins[sec] || 0) + 1;
  $("hud-count").textContent = count;
  const el = $("hud-count").parentElement;
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

function currentRate(now) {
  while (strokes.length && now - strokes[0] > RATE_WINDOW_MS) strokes.shift();
  return strokes.length / (RATE_WINDOW_MS / 1000);
}

function processFrame(res, now) {
  const aspect = overlay.width / overlay.height;
  // Xóc nhanh làm tay nhòe nên mô hình hay mất tay vài khung liền. Trong LOST_HAND_MS
  // vẫn giữ trạng thái tay gần nhất thay vì coi là sai tư thế.
  const seen = res.landmarks && res.landmarks.length ? analyzeHand(res.landmarks[0], aspect) : null;
  if (seen) { hand = seen; lastHandAt = now; }
  else if (now - lastHandAt > LOST_HAND_MS) { hand = null; curlEma = null; detector.reset(); smoothY = null; }

  let progress = 0;
  if (state === "ready" || state === "result") {
    progress = palmHold.update(!!hand && hand.open, now);
    setGesture(t(state === "ready" ? "gPalmReady" : "gPalmReplay"), progress);
    if (progress >= 1) { enterAnchor(); return; }
  } else if (state === "anchor") {
    // Nắm tay như cầm trụ và giữ yên → đặt điểm neo tại đó
    const inZone = !!hand && Math.abs(hand.x - 0.5) < ANCHOR_ZONE_X && Math.abs(hand.y - 0.5) < ANCHOR_ZONE_Y;
    const gripping = !!hand && hand.grip && inZone;
    if (!gripping) { anchorRef = null; axisEma = null; }
    else if (!anchorRef || Math.hypot((hand.x - anchorRef.x) * aspect, hand.y - anchorRef.y) > hand.size * ANCHOR_STILL) {
      anchorRef = { x: hand.x, y: hand.y }; // tay dịch chuyển → đếm lại từ đầu
      anchorHold.reset();
      axisEma = null;
    }
    if (gripping && seen) {
      // Làm mượt trục tay trong lúc giữ yên; lật dấu nếu khung này ngược với trung bình
      if (!axisEma) axisEma = { ux: seen.ux, uy: seen.uy };
      else {
        const s = seen.ux * axisEma.ux + seen.uy * axisEma.uy < 0 ? -1 : 1;
        axisEma.ux = axisEma.ux * 0.8 + s * seen.ux * 0.2;
        axisEma.uy = axisEma.uy * 0.8 + s * seen.uy * 0.2;
      }
    }
    progress = anchorHold.update(gripping, now);
    setGesture(t(!hand || !hand.grip ? "gGrip" : !inZone ? "gCenter" : "gHold"), progress);
    if (progress >= 1) {
      const len = Math.hypot(axisEma.ux, axisEma.uy) || 1;
      anchor = { x: hand.x, y: hand.y, size: hand.size, ux: axisEma.ux / len, uy: axisEma.uy / len };
      detector.reset();
      smoothY = null;
      startCountdown();
    }
  } else if (state === "countdown") {
    setGesture(t("gCountdown"));
  }

  // Kiểm tra bám trụ khi đang đếm ngược / chơi
  // Khung không thấy tay thì giữ nguyên kết quả khung trước
  if (!hand) onRod = false;
  else if (seen && (state === "countdown" || state === "playing")) {
    onRod = isOnRod(hand, aspect);
    if (onRod) invalidSince = null;
    else if (invalidSince === null) invalidSince = now;
    // Sai tư thế hoặc rời trụ quá lâu → huỷ nhát đang dở, phải xóc lại trọn nhát trên trụ
    if (invalidSince !== null && now - invalidSince > INVALID_GRACE_MS) detector.reset();
    if (state === "playing") { framesTotal++; if (onRod) framesOnRod++; }
  }

  if (seen) {
    if (anchor) feedSample(rodCoords(seen, aspect).along, anchor.size, now);
    else feedSample(seen.y, seen.size, now);
  }
  draw(seen, progress);
}

// ---------- Vẽ lớp phủ ----------
function draw(seen, progress) {
  const w = overlay.width, h = overlay.height;
  octx.clearRect(0, 0, w, h);

  if (anchor && (state === "countdown" || state === "playing")) {
    const half = anchor.size * ROD_HALF_LEN * h;
    const tol = anchor.size * ROD_TOL_X * h;
    // Trắng: đúng trụ · Đỏ: buông tay / lệch trụ · Xám: mất dấu tay
    const color = !hand ? "#8b8b8b" : onRod ? "#f2f2f2" : "#ff3b3b";
    // Vẽ trong hệ toạ độ của trụ: gốc tại điểm neo, trục y cục bộ trùng trục trụ
    octx.save();
    octx.translate(anchor.x * w, anchor.y * h);
    octx.rotate(Math.atan2(anchor.uy, anchor.ux) - Math.PI / 2);
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
    const rodW = anchor.size * 0.3 * h;
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
  }

  if (!seen) return;
  const { lm } = seen;
  octx.globalAlpha = 0.9;
  octx.fillStyle = seen.released ? "#ff3b3b" : "#f2f2f2";
  for (const p of lm) {
    octx.beginPath();
    octx.arc(p.x * w, p.y * h, 2.5, 0, Math.PI * 2);
    octx.fill();
  }
  octx.globalAlpha = 1;
  // Vòng tiến độ cử chỉ quanh lòng bàn tay
  if (progress > 0) {
    const r = seen.size * 0.9 * h;
    octx.lineWidth = 3;
    octx.strokeStyle = "rgba(242,242,242,.25)";
    octx.beginPath();
    octx.arc(seen.x * w, seen.y * h, r, 0, Math.PI * 2);
    octx.stroke();
    octx.strokeStyle = "#f2f2f2";
    octx.beginPath();
    octx.arc(seen.x * w, seen.y * h, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    octx.stroke();
  }
}

// ---------- Chế độ phím / chạm ----------
const KEY_Y = { ArrowUp: 0.3, KeyW: 0.3, ArrowDown: 0.7, KeyS: 0.7 };
window.addEventListener("keydown", (e) => {
  if (input !== "keyboard" || !(e.code in KEY_Y)) return;
  e.preventDefault();
  if (e.repeat) return;
  lastHandAt = performance.now();
  feedSample(KEY_Y[e.code], 0.2, performance.now());
});
document.querySelector(".cam-wrap").addEventListener("pointerdown", (e) => {
  if (input !== "keyboard" || (state !== "playing" && state !== "countdown")) return;
  const r = e.currentTarget.getBoundingClientRect();
  lastHandAt = performance.now();
  feedSample((e.clientY - r.top) / r.height < 0.5 ? 0.3 : 0.7, 0.2, performance.now());
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
  bins = new Array(duration).fill(0);
  strokes = [];
  framesOnRod = 0;
  framesTotal = 0;
  playStart = performance.now();
  $("hud-count").textContent = "0";
  show("playing");
}

function finish() {
  show("result");
  beep(220, 400, 0.1, "sawtooth");
  const avg = count / duration;
  const prev = getBest();
  if (count > prev) localStorage.setItem(bestKey(), String(count));
  lastResult = {
    avg,
    count,
    duration,
    peak: Math.max(0, ...bins),
    bins: [...bins],
    tier: TIER_MIN.filter((m) => avg >= m).length - 1,
    gripPct: input === "camera" && framesTotal ? Math.round((framesOnRod / framesTotal) * 100) : null,
    prevBest: prev,
  };
  renderResult();
  if (avg >= 3) say("Ambatukam!");
}

function renderResult() {
  const r = lastResult;
  const [title, note] = t("tiers")[r.tier];
  $("res-avg").textContent = r.avg.toFixed(2);
  $("res-title").textContent = title;
  $("res-note").textContent = note;
  $("res-total").textContent = r.count;
  $("res-peak").textContent = r.peak;
  $("res-grip-wrap").classList.toggle("hidden", r.gripPct === null);
  $("res-grip").textContent = r.gripPct === null ? "" : `${r.gripPct}%`;
  $("res-best").textContent = r.count > r.prevBest
    ? (r.prevBest ? t("newBest", r.prevBest) : t("firstBest"))
    : t("bestShort", r.prevBest, r.duration);
  drawChart($("res-chart"), r.bins, r.peak);
}

function drawChart(canvas, data, peak) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height, pad = 16, top = 22;
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(MAX_RATE, ...data);
  const bw = (w - pad * 2) / data.length;
  data.forEach((v, i) => {
    const bh = (v / max) * (h - pad - top);
    ctx.fillStyle = v === peak && v > 0 ? "#ff3b3b" : "#555";
    ctx.fillRect(pad + i * bw + 1, h - pad - bh, Math.max(1, bw - 2), bh);
  });
  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(pad, h - pad, w - pad * 2, 1);
  ctx.fillStyle = "#8b8b8b";
  ctx.font = "11px system-ui";
  ctx.fillText(t("chartLabel").toUpperCase(), pad, 12);
  ctx.fillText("0s", pad, h - 3);
  ctx.textAlign = "right";
  ctx.fillText(`${data.length}s`, w - pad, h - 3);
  ctx.textAlign = "left";
}

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
  ctx.fillText("AMBATUKAM", 130, 124);
  ctx.font = "700 260px ui-monospace, Menlo, monospace";
  ctx.fillText(r.avg.toFixed(2), 80, 480);
  ctx.fillStyle = "#8b8b8b";
  ctx.font = "32px system-ui";
  ctx.fillText(t("avg").toUpperCase(), 84, 540);
  ctx.fillStyle = "#f2f2f2";
  ctx.font = "800 72px system-ui";
  ctx.fillText(title, 80, 680);
  ctx.fillStyle = "#8b8b8b";
  ctx.font = "36px system-ui";
  ctx.fillText(t("shareSub", r.count, r.duration, r.peak), 80, 740);
  ctx.drawImage($("res-chart"), 80, 800, 920, 180);
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  const file = new File([blob], "ambatukam-score.png", { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Ambatukam Game", text: t("shareText", r.avg.toFixed(2)) }); return; } catch {}
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

  // Thanh lực
  const rate = currentRate(now);
  displayRate += (rate - displayRate) * 0.2;
  const pct = Math.min(1, displayRate / MAX_RATE);
  const fill = $("power-fill");
  fill.style.height = (pct * 100).toFixed(1) + "%";
  fill.style.setProperty("--pct", (pct * 100).toFixed(1) + "%"); // bản mobile nằm ngang
  $("power-bar").classList.toggle("maxed", pct > 0.95);
  $("power-value").textContent = displayRate.toFixed(1);
  const marker = $("power-hand");
  const visible = smoothY !== null && handVisible();
  marker.classList.toggle("on", visible);
  if (visible) {
    // Có neo: smoothY là vị trí dọc trụ (−half..half) → quy về 0..1 theo chiều dài trụ
    const pos = anchor && input === "camera" ? 0.5 + smoothY / (2 * anchor.size * ROD_HALF_LEN) : smoothY;
    marker.style.top = `calc(${(Math.min(1, Math.max(0, pos)) * 100).toFixed(1)}% - 1px)`;
  }

  if (state === "playing") {
    const left = Math.max(0, duration - (now - playStart) / 1000);
    $("hud-time").textContent = left.toFixed(1);
    let status = "";
    if (input === "camera") {
      if (!hand) status = t("sLost");
      else if (hand.released) status = t("sGrip");
      else if (!onRod) status = t("sAnchor");
    }
    $("hud-status").textContent = status;
    if (left <= 0) finish();
  }
}

// Hook để test logic bằng dữ liệu tay giả: mở trang với ?debug
// Thêm &auto=result|play&lang=vi để nhảy thẳng tới một màn hình (chụp ảnh giao diện).
const params = new URLSearchParams(location.search);
if (params.has("debug")) {
  window.__amb = {
    processFrame,
    useFakeCamera() { input = "camera"; overlay.width = 640; overlay.height = 480; show("ready"); },
    get state() { return state; },
    get count() { return count; },
    get anchor() { return anchor; },
    get onRod() { return onRod; },
  };
  if (params.get("lang")) lang = params.get("lang");
  const auto = params.get("auto");
  if (auto) {
    window.__amb.useFakeCamera();
    duration = 10;
    // Trụ nghiêng 25° để thấy rõ trục theo tay
    const tilt = (25 * Math.PI) / 180;
    anchor = { x: 0.5, y: 0.5, size: 0.14, ux: Math.sin(tilt), uy: Math.cos(tilt) };
    // Tay nắm giả: cổ tay bên trái, các khớp xếp dọc theo trục trụ
    const fakeHand = (cx, cy) => {
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
    if (auto === "play") {
      startPlaying();
      count = 12; $("hud-count").textContent = count;
      for (let i = 0; i < 6; i++) strokes.push(performance.now() - i * 200);
      processFrame({ landmarks: [fakeHand(0.5, 0.5)] }, performance.now());
    } else {
      count = 39; bins = [3, 4, 4, 5, 4, 4, 4, 4, 4, 3]; framesTotal = 100; framesOnRod = 82;
      finish();
    }
  }
}

applyLang();
requestAnimationFrame(loop);
