// Ambatukam Game engine
// Đếm số nhát xóc dọc theo một "thanh trụ ảo" đặt tại điểm neo. Nhận diện tay bằng
// MediaPipe Hand Landmarker, chạy hoàn toàn trong trình duyệt.
//
// Chế độ:
//   single  — 1 tay, 1 trụ, thời gian cố định, tính nhát/giây trung bình
//   double  — 2 tay, 2 trụ, thời gian cố định
//   random  — trụ xuất hiện ngẫu nhiên, phải đuổi theo; thanh Lửa cạn dần, hết Lửa là thua
//
// Engine không phụ thuộc React: nó chạy vòng requestAnimationFrame, vẽ canvas, và ghi trạng thái
// ra hai Store (ui: đổi theo bước chơi, hud: đổi mỗi khung) để React hiển thị.
import { beep, countdownHit, countdownStart, initAudio } from "./audio";
import { CameraNoFramesError, startCamera, stopCamera } from "./camera";
import {
  ANCHOR_HOLD_MS,
  ANCHOR_ZONE_X,
  ANCHOR_ZONE_Y,
  COUNTDOWN_STEP_MS,
  COUNTDOWN_STEPS,
  DOUBLE_ZONE_X,
  HAND_MIN_GAP,
  INVALID_GRACE_MS,
  MAX_RATE,
  PALM_HOLD_MS,
  RATE_WINDOW_MS,
  RND_DRAIN_BASE,
  RND_DRAIN_RAMP,
  RND_METER_START,
  RND_MIN_JUMP,
  RND_ROD_LIFE_MAX,
  RND_ROD_LIFE_MIN,
  RND_ROD_LIFE_STEP,
  RND_STROKE_GAIN,
  RND_TILT_MAX,
  ROD_HALF_LEN,
} from "./constants";
import { HandTrack, assignHands, rodScale } from "./HandTrack";
import { Hold } from "./Hold";
import { createCpuTracker, createTracker, type Delegate, type Tracker } from "./landmarker";
import { drawOverlay } from "./render";
import { Store } from "./Store";
import { isTimed, type HandPose, type Landmarks, type RunConfig, type RunResult } from "./types";

export type Phase = "idle" | "ready" | "anchor" | "countdown" | "playing" | "result";

/** Hướng dẫn cử chỉ (khoá chuỗi i18n) */
export type GestureKey =
  | "gPalmReady"
  | "gGrip"
  | "gGripBoth"
  | "gTwoHands"
  | "gCenter"
  | "gApart"
  | "gHold"
  | "gCountdown"
  | "gCountdownRandom";

/** Cảnh báo khi đang chơi (khoá chuỗi i18n) */
export type StatusKey = "sLost" | "sOneHand" | "sGrip" | "sAnchor" | "sGoRod";

export type Boot =
  | { step: "idle" | "opening" | "loading" | "ready" }
  | { step: "error"; noFrames: boolean; message: string };

export interface UiState {
  phase: Phase;
  boot: Boot;
  gesture: GestureKey | null;
  gestureProgress: number;
  /** Tiến độ "xòe tay để chơi lại" khi đang ở màn kết quả */
  replayProgress: number;
  countdown: string;
  /** Tỉ lệ khung camera thật (rộng / cao), null khi chưa bật camera */
  aspect: number | null;
}

export interface HudState {
  /** Giây còn lại (ván tính giờ) hoặc đã chơi (random), làm tròn 0.1 */
  time: number;
  count: number;
  split: [number, number] | null;
  status: StatusKey | null;
  /** Thanh bên: lực (nhát/giây) hoặc Lửa (random), 0..1 */
  powerPct: number;
  powerValue: number;
  heat: boolean;
  maxed: boolean;
  low: boolean;
  /** Vị trí tay dọc theo trụ (0..1) để vẽ vạch trên thanh lực, null nếu ẩn */
  marker: number | null;
}

export interface EngineHandlers {
  onPlayStart?: (config: RunConfig) => void;
  onFinish?: (run: RunResult) => void;
}

/** Số liệu của ván đang chơi */
interface RunState {
  strokes: number[]; // timestamp các nhát gần đây (để tính tốc độ tức thời)
  count: number;
  playStart: number;
  bins: number[]; // số nhát theo từng giây
  framesOnRod: number;
  framesTotal: number;
  meter: number; // Random: Lửa (%)
  rodSpawnAt: number;
  rodsCaught: number;
  rodHasStroke: boolean;
  lastTick: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export class GameEngine {
  readonly ui = new Store<UiState>({
    phase: "idle",
    boot: { step: "idle" },
    gesture: null,
    gestureProgress: 0,
    replayProgress: 0,
    countdown: COUNTDOWN_STEPS[0],
    aspect: null,
  });
  readonly hud = new Store<HudState>({
    time: 0,
    count: 0,
    split: null,
    status: null,
    powerPct: 0,
    powerValue: 0,
    heat: false,
    maxed: false,
    low: false,
    marker: null,
  });
  /** Dòng chẩn đoán (chỉ cập nhật khi bật debug) */
  readonly diagText = new Store({ text: "" });
  readonly diag = { delegate: null as Delegate | null, frames: 0, fps: 0, hands: 0, size: 0, error: "", at: 0 };
  /** Bật dòng chẩn đoán (diagText) */
  readonly debug: boolean;

  config: RunConfig = { mode: "single", duration: 20 };
  tracks: HandTrack[] = [new HandTrack()];
  readonly run: RunState = {
    strokes: [],
    count: 0,
    playStart: 0,
    bins: [],
    framesOnRod: 0,
    framesTotal: 0,
    meter: 0,
    rodSpawnAt: 0,
    rodsCaught: 0,
    rodHasStroke: false,
    lastTick: 0,
  };

  private handlers: EngineHandlers = {};
  private video: HTMLVideoElement | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private octx: CanvasRenderingContext2D | null = null;
  // Khung camera được chụp vào đây trước khi nhận diện, rồi vẽ đúng khung này ra màn hình.
  // Đọc thẳng từ <video> sau khi nhận diện thì Chrome Android có thể đã sang khung mới hơn.
  private readonly frame = document.createElement("canvas");
  private readonly fctx = this.frame.getContext("2d")!;
  private tracker: Tracker | null = null;
  private trackerLoad: Promise<Tracker> | null = null;
  private fallingBack = false;
  private detectPaused = false;
  private lastVideoTime = -1;
  private lastDetectAt = 0;
  private frameDrawnAt = 0;
  private displayRate = 0;
  private refSize = 0.12; // cỡ tay đo lúc xòe tay, dùng để vẽ trụ ngẫu nhiên
  private gesturesEnabled = true;
  private raf = 0;
  private timers: number[] = [];
  private readonly palmHold = new Hold(PALM_HOLD_MS);
  private readonly anchorHold = new Hold(ANCHOR_HOLD_MS);

  constructor({ debug = false }: { debug?: boolean } = {}) {
    this.debug = debug;
  }

  get phase(): Phase {
    return this.ui.get().phase;
  }

  private get timed(): boolean {
    return isTimed(this.config.mode);
  }

  setHandlers(handlers: EngineHandlers): void {
    this.handlers = handlers;
  }

  /** Gắn vào <video> + <canvas> và chạy vòng lặp. Gọi unmount() để dừng. */
  mount(video: HTMLVideoElement, overlay: HTMLCanvasElement): void {
    this.video = video;
    this.overlay = overlay;
    this.octx = overlay.getContext("2d");
    video.addEventListener("resize", this.fitCamera);
    this.raf = requestAnimationFrame(this.loop);
  }

  unmount(): void {
    cancelAnimationFrame(this.raf);
    this.clearTimers();
    this.video?.removeEventListener("resize", this.fitCamera);
    if (this.video) stopCamera(this.video);
    this.tracker?.landmarker.close();
    this.tracker = null;
    this.trackerLoad = null;
    this.video = this.overlay = this.octx = null;
    this.ui.update({ phase: "idle", boot: { step: "idle" }, aspect: null });
  }

  /** Chỉ dùng khi debug / test: giả lập khung camera 640x480 khi không có camera thật */
  fakeCamera(width = 640, height = 480): void {
    if (!this.overlay) return;
    this.overlay.width = this.frame.width = width;
    this.overlay.height = this.frame.height = height;
    this.setupTracks();
    this.setPhase("ready");
  }

  /** Bỏ qua cử chỉ (đang gõ tên, đang xem bảng xếp hạng…) */
  setGesturesEnabled(enabled: boolean): void {
    this.gesturesEnabled = enabled;
  }

  /** Bấm "Bật camera & chơi": mở camera, tải mô hình, chờ xòe tay */
  async begin(config: RunConfig): Promise<void> {
    if (!this.video) return;
    initAudio();
    this.config = config;
    this.setupTracks();
    this.setPhase("ready");
    try {
      this.ui.update({ boot: { step: "opening" } });
      await startCamera(this.video);
      this.fitCamera();
      this.ui.update({ boot: { step: "loading" } });
      await this.loadTracker();
      this.ui.update({ boot: { step: "ready" } });
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      this.ui.update({ boot: { step: "error", noFrames: err instanceof CameraNoFramesError, message } });
    }
  }

  /** Chơi lại cùng chế độ (nút Chơi lại hoặc xòe tay ở màn kết quả) */
  replay(): void {
    for (const tr of this.tracks) tr.clearAnchor();
    beep(660, 80, 0.08, "sine");
    if (this.config.mode === "random") {
      this.spawnRod();
      this.startCountdown();
    } else this.setPhase("anchor");
  }

  /** Về màn chọn chế độ (camera vẫn bật) */
  goIdle(): void {
    this.clearTimers();
    this.setPhase("idle");
  }

  // ---------- Camera + mô hình ----------
  private loadTracker(): Promise<Tracker> {
    const forced = new URLSearchParams(location.search).get("delegate")?.toUpperCase();
    this.trackerLoad ??= createTracker(
      this.tracks.length,
      forced === "CPU" || forced === "GPU" ? forced : undefined,
    ).then(
      (t) => {
        this.tracker = t;
        this.diag.delegate = t.delegate;
        this.diag.error = t.note;
        return t;
      },
      (err: unknown) => {
        this.trackerLoad = null;
        throw err;
      },
    );
    return this.trackerLoad;
  }

  // Khung hình theo đúng tỉ lệ video (điện thoại cầm dọc trả về video dọc), cập nhật khi xoay máy
  private fitCamera = (): void => {
    const v = this.video;
    if (!v?.videoWidth || !this.overlay) return;
    this.overlay.width = this.frame.width = v.videoWidth;
    this.overlay.height = this.frame.height = v.videoHeight;
    this.ui.update({ aspect: v.videoWidth / v.videoHeight });
  };

  setupTracks(): void {
    this.tracks = this.config.mode === "double" ? [new HandTrack(), new HandTrack()] : [new HandTrack()];
    // CPU tìm đúng số tay của chế độ: đổi chế độ thì cập nhật, tạm dừng nhận diện trong lúc mô hình dựng lại
    const t = this.tracker;
    if (t?.delegate === "CPU") {
      this.detectPaused = true;
      void t.landmarker.setOptions({ numHands: this.tracks.length }).finally(() => {
        this.detectPaused = false;
      });
    }
  }

  private async fallbackToCpu(): Promise<void> {
    const old = this.tracker;
    if (this.fallingBack || old?.delegate !== "GPU") return;
    this.fallingBack = true;
    this.tracker = null;
    try {
      this.tracker = await createCpuTracker(this.tracks.length);
      this.trackerLoad = Promise.resolve(this.tracker);
      this.diag.delegate = "CPU";
      old.landmarker.close();
    } catch (err) {
      console.error(err);
      this.tracker = old;
    } finally {
      this.fallingBack = false;
    }
  }

  // ---------- Điều hướng ----------
  setPhase(phase: Phase): void {
    this.palmHold.reset();
    this.anchorHold.reset();
    this.ui.update({ phase, gesture: null, gestureProgress: 0, replayProgress: 0 });
  }

  private setGesture(gesture: GestureKey | null, progress = 0): void {
    this.ui.update({ gesture, gestureProgress: Math.round(progress * 100) / 100 });
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private clearTimers(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  // ---------- Random: sinh trụ ở chỗ mới ----------
  private spawnRod(): void {
    const tr = this.tracks[0];
    const aspect = this.aspect();
    const prev = tr.anchor;
    let x: number;
    let y: number;
    let tries = 0;
    do {
      x = 0.25 + Math.random() * 0.5;
      y = 0.3 + Math.random() * 0.4;
    } while (prev && Math.hypot((x - prev.x) * aspect, y - prev.y) < RND_MIN_JUMP && ++tries < 20);
    const tilt = ((Math.random() * 2 - 1) * RND_TILT_MAX * Math.PI) / 180;
    tr.anchor = { x, y, size: this.refSize, ux: Math.sin(tilt), uy: Math.cos(tilt) };
    tr.clearMotion();
    tr.invalidSince = null;
    this.run.rodSpawnAt = performance.now();
    this.run.rodHasStroke = false;
    beep(990, 60, 0.07, "sine");
    this.later(() => beep(1320, 60, 0.07, "sine"), 70);
  }

  private aspect(): number {
    const o = this.overlay;
    return o && o.height ? o.width / o.height : 4 / 3;
  }

  // ---------- Xử lý một nhát ----------
  private onStroke(tr: HandTrack, now: number): void {
    const r = this.run;
    r.strokes.push(now);
    beep(440 + this.currentRate(now) * 120, 45, 0.06);
    if (this.phase !== "playing") return;
    const sec = Math.floor((now - r.playStart) / 1000);
    if (this.timed && sec >= this.config.duration) return; // hết giờ nhưng chưa kịp sang màn kết quả
    r.count++;
    tr.count++;
    while (r.bins.length <= sec) r.bins.push(0);
    r.bins[sec]++;
    if (this.config.mode === "random") {
      r.meter = Math.min(100, r.meter + RND_STROKE_GAIN);
      if (!r.rodHasStroke) {
        r.rodHasStroke = true;
        r.rodsCaught++;
      }
    }
    this.updateCount();
  }

  updateCount(): void {
    const [a, b] = this.tracks;
    this.hud.update({
      count: this.run.count,
      split: this.config.mode === "double" && b ? [a.count, b.count] : null,
    });
  }

  private currentRate(now: number): number {
    const s = this.run.strokes;
    while (s.length && now - s[0] > RATE_WINDOW_MS) s.shift();
    return s.length / (RATE_WINDOW_MS / 1000);
  }

  // ---------- Xử lý một khung hình camera ----------
  processFrame(res: { landmarks?: Landmarks[] }, now: number): void {
    const aspect = this.aspect();
    const phase = this.phase;
    const tracks = this.tracks;
    const assigned = assignHands(tracks, res.landmarks ?? [], aspect, this.config.mode === "random");
    // Xóc nhanh làm tay nhòe nên mô hình hay mất tay vài khung liền. Trong LOST_HAND_MS
    // vẫn giữ trạng thái tay gần nhất thay vì coi là sai tư thế.
    const seen = tracks.map((tr, i): HandPose | null => {
      const lm = assigned[i];
      if (lm) {
        tr.hand = tr.analyze(lm, aspect);
        tr.lastAt = now;
        return tr.hand;
      }
      if (!tr.visible(now)) {
        tr.hand = null;
        tr.curlEma = null;
        tr.clearMotion();
      }
      return null;
    });
    const hands = tracks.map((tr) => tr.hand);

    let progress = 0;
    if (phase === "ready" || phase === "result") {
      const openHand = hands.find((h) => h?.open);
      progress = this.palmHold.update(Boolean(openHand) && this.gesturesEnabled, now);
      if (openHand) this.refSize = openHand.size;
      if (phase === "ready") this.setGesture("gPalmReady", progress);
      else this.ui.update({ replayProgress: Math.round(progress * 100) / 100 });
      if (progress >= 1) {
        this.replay();
        return;
      }
    } else if (phase === "anchor") {
      progress = this.updateAnchorPhase(hands, seen, aspect, now);
      if (progress >= 1) {
        tracks.forEach((tr) => tr.commitAnchor(tr.hand!));
        this.startCountdown();
      }
    } else if (phase === "countdown") {
      this.setGesture(this.config.mode === "random" ? "gCountdownRandom" : "gCountdown");
    }

    // Kiểm tra bám trụ khi đang đếm ngược / chơi. Khung không thấy tay thì giữ nguyên kết quả khung trước.
    const active = phase === "countdown" || phase === "playing";
    tracks.forEach((tr, i) => {
      if (!tr.hand) {
        tr.onRod = false;
        return;
      }
      if (!seen[i] || !active) return;
      tr.onRod = tr.isOnRod(tr.hand, aspect);
      if (tr.onRod) tr.invalidSince = null;
      else tr.invalidSince ??= now;
      // Sai tư thế hoặc rời trụ quá lâu → huỷ nhát đang dở, phải xóc lại trọn nhát trên trụ
      if (tr.invalidSince !== null && now - tr.invalidSince > INVALID_GRACE_MS) tr.detector.reset();
    });
    if (phase === "playing") {
      this.run.framesTotal++;
      if (tracks.every((tr) => tr.onRod)) this.run.framesOnRod++;
    }

    // Đưa mẫu vào bộ đếm: có neo thì theo trục trụ, chưa có thì theo chiều dọc màn hình
    tracks.forEach((tr, i) => {
      const h = seen[i];
      if (!h) return;
      const rev = tr.anchor ? tr.feed(tr.rodCoords(h, aspect, tr.anchor).along, tr.anchor.size) : tr.feed(h.y, h.size);
      if (rev === "bottom") this.onStroke(tr, now);
      else if (rev === "top") beep(330, 30, 0.03);
    });
    this.draw(seen, progress, active);
  }

  // Bước đặt neo: mọi tay phải nắm, ở trong vùng cho phép, và giữ yên cùng lúc
  private updateAnchorPhase(hands: (HandPose | null)[], seen: (HandPose | null)[], aspect: number, now: number): number {
    const need = this.tracks.length;
    const present = hands.filter((h): h is HandPose => h !== null);
    const zoneX = need === 2 ? DOUBLE_ZONE_X : ANCHOR_ZONE_X;
    const inZone = (h: HandPose) => Math.abs(h.x - 0.5) < zoneX && Math.abs(h.y - 0.5) < ANCHOR_ZONE_Y;
    let ok = present.length === need && present.every((h) => h.grip && inZone(h));
    let apart = true;
    if (ok && need === 2) {
      const [a, b] = present;
      apart = Math.hypot((a.x - b.x) * aspect, a.y - b.y) > HAND_MIN_GAP * Math.max(a.size, b.size);
      ok = apart;
    }
    if (ok) {
      this.tracks.forEach((tr, i) => {
        if (!tr.updateStill(tr.hand!, aspect)) this.anchorHold.reset();
        const s = seen[i];
        if (s) tr.accumulateAxis(s);
      });
    } else {
      this.tracks.forEach((tr) => {
        tr.anchorRef = null;
        tr.axisEma = null;
      });
    }
    const progress = this.anchorHold.update(ok, now);
    let msg: GestureKey;
    if (present.length < need) msg = need === 2 ? "gTwoHands" : "gGrip";
    else if (!present.every((h) => h.grip)) msg = need === 2 ? "gGripBoth" : "gGrip";
    else if (!present.every(inZone)) msg = "gCenter";
    else if (!apart) msg = "gApart";
    else msg = "gHold";
    this.setGesture(msg, progress);
    return progress;
  }

  private draw(seen: (HandPose | null)[], progress: number, active: boolean): void {
    if (!this.octx) return;
    // Vẽ đúng khung hình vừa nhận diện lên canvas (phủ lên video) để tay, chấm và trụ luôn khớp nhau.
    // Nhận diện chậm (CPU trên điện thoại ~40ms/khung) mà để video chạy riêng thì chấm trễ hẳn sau tay lúc xóc.
    const hasFrame = (this.video?.readyState ?? 0) >= 2;
    if (hasFrame) this.frameDrawnAt = performance.now();
    const spawnAge = this.config.mode === "random" ? (performance.now() - this.run.rodSpawnAt) / 500 : null;
    drawOverlay(this.octx, {
      frame: hasFrame ? this.frame : null,
      tracks: this.tracks,
      seen,
      progress,
      showRods: active,
      spawnAge,
    });
  }

  // ---------- Vòng chơi ----------
  private startCountdown(): void {
    this.setPhase("countdown");
    countdownStart();
    COUNTDOWN_STEPS.forEach((step, i) => {
      this.later(() => {
        this.ui.update({ countdown: step });
        const last = i === COUNTDOWN_STEPS.length - 1;
        countdownHit(last, i);
        if (last) this.later(() => this.startPlaying(), 400);
      }, i * COUNTDOWN_STEP_MS);
    });
  }

  startPlaying(): void {
    const r = this.run;
    const now = performance.now();
    r.count = 0;
    for (const tr of this.tracks) tr.count = 0;
    r.bins = this.timed ? new Array<number>(this.config.duration).fill(0) : [];
    r.strokes = [];
    r.framesOnRod = 0;
    r.framesTotal = 0;
    r.meter = RND_METER_START;
    r.rodsCaught = 0;
    r.rodHasStroke = false;
    r.playStart = now;
    r.lastTick = now;
    if (this.config.mode === "random") r.rodSpawnAt = now;
    this.handlers.onPlayStart?.(this.config);
    this.updateCount();
    this.setPhase("playing");
  }

  finish(): void {
    beep(220, 400, 0.1, "sawtooth");
    const r = this.run;
    const elapsed = (performance.now() - r.playStart) / 1000;
    // Random: đệm đủ số giây đã chơi để biểu đồ và đỉnh tính đúng
    if (!this.timed) while (r.bins.length < Math.ceil(elapsed)) r.bins.push(0);
    const result: RunResult = {
      ...this.config,
      score: this.timed ? r.count : round1(elapsed),
      count: r.count,
      bins: [...r.bins],
      peak: Math.max(0, ...r.bins),
      split: this.tracks.map((tr) => tr.count),
      rods: r.rodsCaught,
      // Số liệu gửi kèm điểm để server đối chiếu (xem backend/src/app/services/anticheat.py)
      grip: r.framesTotal ? Math.round((r.framesOnRod / r.framesTotal) * 100) : 0,
      fps: round1(r.framesTotal / Math.max(1, elapsed)),
    };
    this.setPhase("result");
    this.handlers.onFinish?.(result);
  }

  // ---------- Main loop ----------
  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    this.detect(now);
    // Ngừng nhận diện (đổi chế độ…) thì xoá khung đứng hình để lộ video bên dưới
    if (this.frameDrawnAt && now - this.frameDrawnAt > 250 && this.octx && this.overlay) {
      this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      this.frameDrawnAt = 0;
    }
    if (this.debug) this.updateDiag(now);
    this.tick(now);
  };

  private detect(now: number): void {
    const v = this.video;
    const t = this.tracker;
    // Bỏ qua khung trùng; vài trình duyệt di động không tăng currentTime của luồng camera nên vẫn chạy mỗi ~33ms
    if (!v || !t || this.detectPaused || v.readyState < 2) return;
    if (v.currentTime === this.lastVideoTime && now - this.lastDetectAt <= 33) return;
    this.lastVideoTime = v.currentTime;
    this.lastDetectAt = now;
    let res;
    try {
      this.fctx.drawImage(v, 0, 0, this.frame.width, this.frame.height);
      res = t.landmarker.detectForVideo(this.frame, now);
    } catch (err) {
      console.error(err);
      this.diag.error = err instanceof Error ? err.message : String(err);
      void this.fallbackToCpu();
      return;
    }
    this.diag.frames++;
    this.diag.hands = res.landmarks.length;
    this.diag.size = this.tracks.find((tr) => tr.hand)?.hand?.size ?? 0;
    this.processFrame(res, now);
  }

  private updateDiag(now: number): void {
    const d = this.diag;
    if (now - d.at < 1000) return;
    d.fps = Math.round((d.frames * 1000) / (now - (d.at || now - 1000)));
    d.frames = 0;
    d.at = now;
    const v = this.video;
    this.diagText.update({
      text:
        `${d.delegate ?? "-"} · video ${v?.videoWidth}x${v?.videoHeight} · ${d.fps} fps · hands ${d.hands}` +
        (d.size ? ` · size ${d.size.toFixed(2)}` : "") +
        (d.error ? `\n${d.error}` : ""),
    });
  }

  private tick(now: number): void {
    const r = this.run;
    const phase = this.phase;
    const random = this.config.mode === "random";

    // Random: Lửa cạn dần, trụ đổi chỗ
    if (phase === "playing" && random) {
      const elapsed = (now - r.playStart) / 1000;
      const dt = (now - r.lastTick) / 1000;
      r.meter -= (RND_DRAIN_BASE + RND_DRAIN_RAMP * elapsed) * dt;
      const rodLife = Math.max(RND_ROD_LIFE_MIN, RND_ROD_LIFE_MAX - elapsed * RND_ROD_LIFE_STEP);
      if (now - r.rodSpawnAt > rodLife) this.spawnRod();
      if (r.meter <= 0) {
        r.meter = 0;
        this.finish();
      }
    }
    r.lastTick = now;

    // Thanh bên: lực (nhát/giây) hoặc Lửa (random)
    this.displayRate += (this.currentRate(now) - this.displayRate) * 0.2;
    const heat = random && (this.phase === "playing" || this.phase === "result");
    const pct = heat ? r.meter / 100 : Math.min(1, this.displayRate / MAX_RATE);
    const tr = this.tracks[0];
    let marker: number | null = null;
    if (this.tracks.length === 1 && tr.smooth !== null && tr.visible(now)) {
      // Có neo: smooth là vị trí dọc trụ (−half..half) → quy về 0..1 theo chiều dài trụ
      const pos = tr.anchor ? 0.5 + tr.smooth / (2 * rodScale(tr.anchor) * ROD_HALF_LEN) : tr.smooth;
      marker = Math.round(Math.min(1, Math.max(0, pos)) * 1000) / 1000;
    }

    let time = this.hud.get().time;
    let status: StatusKey | null = null;
    if (this.phase === "playing") {
      const elapsed = (now - r.playStart) / 1000;
      const left = Math.max(0, this.config.duration - elapsed);
      time = round1(this.timed ? left : elapsed);
      const missing = this.tracks.filter((x) => !x.hand).length;
      if (missing === this.tracks.length) status = "sLost";
      else if (missing) status = "sOneHand";
      else if (this.tracks.some((x) => x.hand!.released)) status = "sGrip";
      else if (this.tracks.some((x) => !x.onRod)) status = random ? "sGoRod" : "sAnchor";
      if (this.timed && left <= 0) this.finish();
    }

    this.hud.update({
      time,
      status,
      heat,
      powerPct: Math.round(pct * 1000) / 1000,
      powerValue: heat ? Math.round(r.meter) : round1(this.displayRate),
      maxed: !random && pct > 0.95,
      low: random && this.phase === "playing" && pct < 0.3,
      marker,
    });
  }
}
