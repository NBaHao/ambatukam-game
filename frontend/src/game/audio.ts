// Âm thanh bằng Web Audio: tiếng bíp tổng hợp + mẫu giọng thật của meme "I'm about to cum",
// giọng trọng tài đếm 3-2-1-GO và ba cú trầm lấy từ Mixkit.
// Mẫu nằm ở assets/audio, dựng lại bằng frontend/scripts/sound.sh và countdown-sfx.sh.
// AudioContext chỉ tạo được sau thao tác của người dùng.
import almostUrl from "../assets/audio/almost.mp3";
import celebrateUrl from "../assets/audio/celebrate.mp3";
import countdownGoUrl from "../assets/audio/countdown-go.mp3";
import countdownImpactUrl from "../assets/audio/countdown-impact.mp3";
import countdownOneUrl from "../assets/audio/countdown-one.mp3";
import countdownRiserUrl from "../assets/audio/countdown-riser.mp3";
import countdownThreeUrl from "../assets/audio/countdown-three.mp3";
import countdownTickUrl from "../assets/audio/countdown-tick.mp3";
import countdownTwoUrl from "../assets/audio/countdown-two.mp3";
import finishUrl from "../assets/audio/finish.mp3";
import hypeUrl from "../assets/audio/hype.mp3";

let ctx: AudioContext | null = null;

const CLIPS = {
  hype: hypeUrl,
  finish: finishUrl,
  almost: almostUrl,
  celebrate: celebrateUrl,
  tick: countdownTickUrl,
  impact: countdownImpactUrl,
  riser: countdownRiserUrl,
  three: countdownThreeUrl,
  two: countdownTwoUrl,
  one: countdownOneUrl,
  go: countdownGoUrl,
};
type ClipName = keyof typeof CLIPS;
const buffers = new Map<ClipName, Promise<AudioBuffer | null>>();
/** Nhạc chúc mừng đang phát, để tắt khi đóng popup hoặc mở ván mới */
let celebration: AudioBufferSourceNode | null = null;
/** Tăng mỗi lần bật/tắt: mẫu tải xong muộn (mạng chậm) không được phát chồng lên */
let celebrationSeq = 0;

/** Giây tới chữ "cum" trong hype.mp3: tiếng rít dồn tới đây thì nổ. Cắt lại file thì đo lại. */
const HYPE_HIT_AT = 1.08;

function load(name: ClipName): Promise<AudioBuffer | null> {
  let p = buffers.get(name);
  if (!p && ctx) {
    const c = ctx;
    p = fetch(CLIPS[name])
      .then((r) => r.arrayBuffer())
      .then((b) => c.decodeAudioData(b))
      .catch(() => null); // lỗi mạng: chỉ mất mẫu giọng, hiệu ứng tổng hợp vẫn chạy
    buffers.set(name, p);
  }
  return p ?? Promise.resolve(null);
}

/** Đường tiếng cho mọi hiệu ứng (không gồm nhạc chúc mừng), để hạ nhỏ khi nhạc vào */
let sfx: GainNode | null = null;
/** Lần tải + giải mã đầu tiên; `begin()` chờ nó để nhịp đếm ngược đầu tiên không bị mất tiếng */
let ready: Promise<void> | null = null;

/**
 * Gọi trong lượt bấm của người dùng. Trả về promise giải mã xong toàn bộ mẫu:
 * máy chậm / mạng chậm thì chờ, đừng để mấy nhịp đầu chạy trong im lặng.
 */
export function initAudio(): Promise<void> {
  if (!ctx) {
    ctx = new AudioContext();
    sfx = ctx.createGain();
    sfx.connect(ctx.destination);
    // iOS chỉ mở khoá Web Audio khi có buffer phát ngay trong lượt bấm
    const unlock = ctx.createBufferSource();
    unlock.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    unlock.connect(ctx.destination);
    unlock.start(0);
  }
  void ctx.resume();
  ready ??= Promise.all((Object.keys(CLIPS) as ClipName[]).map((name) => load(name))).then(() => undefined);
  return ready;
}

/** Chờ mẫu giải mã xong (gọi trước khi bắt đầu đếm ngược) */
export function audioReady(): Promise<void> {
  return ready ?? Promise.resolve();
}

/** Nhạc chúc mừng vào thì hạ nhỏ tiếng cũ (giọng kết ván, tiếng nổ) thay vì cắt phựt */
function duckSfx(level = 0.15, sec = 0.35): void {
  if (!ctx || !sfx) return;
  const t = ctx.currentTime;
  sfx.gain.cancelScheduledValues(t);
  sfx.gain.setValueAtTime(sfx.gain.value, t);
  sfx.gain.linearRampToValueAtTime(level, t + sec);
}

function unduckSfx(sec = 0.4): void {
  if (!ctx || !sfx) return;
  const t = ctx.currentTime;
  sfx.gain.cancelScheduledValues(t);
  sfx.gain.setValueAtTime(sfx.gain.value, t);
  sfx.gain.linearRampToValueAtTime(1, t + sec);
}

export function beep(freq: number, ms = 60, vol = 0.08, type: OscillatorType = "square"): void {
  if (!ctx || !sfx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
  o.connect(g).connect(sfx);
  o.start();
  o.stop(ctx.currentTime + ms / 1000);
}

/** Một nốt trượt tần số from → to (Hz), bắt đầu sau `at` giây */
function slide(from: number, to: number, sec: number, vol: number, type: OscillatorType, at = 0): void {
  if (!ctx || !sfx) return;
  const t0 = ctx.currentTime + at;
  const t1 = t0 + sec;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t0);
  o.frequency.exponentialRampToValueAtTime(to, t1);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t1);
  o.connect(g).connect(sfx);
  o.start(t0);
  o.stop(t1);
}

/** Tiếng xì (nhiễu trắng qua lọc), bắt đầu sau `at` giây */
function noise(sec: number, vol: number, filterFrom: number, filterTo: number, at = 0): void {
  if (!ctx || !sfx) return;
  const t0 = ctx.currentTime + at;
  const t1 = t0 + sec;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * sec), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const g = ctx.createGain();
  src.buffer = buf;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(filterFrom, t0);
  filter.frequency.exponentialRampToValueAtTime(filterTo, t1);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t1);
  src.connect(filter).connect(g).connect(sfx);
  src.start(t0);
}

/** Tiếng nổ: trống trầm + xì + chuông, bắt đầu sau `at` giây */
function boom(at = 0, vol = 0.5): void {
  slide(140, 38, 0.6, vol, "sine", at);
  noise(0.35, vol * 0.5, 3000, 200, at);
  slide(1760, 1760, 0.5, 0.06, "triangle", at + 0.06);
}

interface PlayOptions {
  vol?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Tốc độ phát, 1 = nguyên bản */
  rate?: number;
  /** Nhạc chúc mừng: đi thẳng ra loa, không qua đường tiếng bị hạ nhỏ */
  music?: boolean;
}

/** Phát một mẫu đã giải mã, trả về source để tắt giữa chừng */
function startClip(buf: AudioBuffer, { vol = 1, fadeIn = 0, fadeOut = 0, rate = 1, music = false }: PlayOptions = {}): AudioBufferSourceNode | null {
  if (!ctx || !sfx) return null;
  if (ctx.state === "suspended") void ctx.resume();
  const t0 = ctx.currentTime;
  const duration = buf.duration / rate;
  const end = t0 + duration;
  const g = ctx.createGain();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  if (fadeIn > 0) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + fadeIn);
  } else {
    g.gain.setValueAtTime(vol, t0);
  }
  if (fadeOut > 0) {
    g.gain.setValueAtTime(vol, Math.max(t0, end - fadeOut));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
  }
  src.connect(g).connect(music ? ctx.destination : sfx);
  src.start(t0);
  return src;
}

/** "I'm about to… cum": màn bắt đầu, nghe trọn câu của meme */
export async function ambatukam(): Promise<void> {
  const buf = await load("hype");
  slide(120, 900, HYPE_HIT_AT, 0.05, "sawtooth");
  if (buf) startClip(buf);
  boom(HYPE_HIT_AT, 0.35);
}

/** Kết thúc ván từ danh hiệu Ambatukam trở lên: vào ngay chữ "cum", nổ luôn */
export async function ambatukamFinish(): Promise<void> {
  const buf = await load("finish");
  if (buf) startClip(buf);
  boom(0, 0.45);
}

/** "I'm about to…" rồi xịt: suýt tới mà không tới */
export async function ambatu(): Promise<void> {
  const buf = await load("almost");
  if (buf) startClip(buf);
  slide(700, 140, 0.9, 0.08, "sine", buf ? buf.duration : 0);
}

/** Bắt đầu đếm ngược: tiếng rít dâng dần chạy suốt 3-2-1 */
export function countdownStart(): void {
  void load("riser").then((buf) => {
    if (buf) startClip(buf, { vol: 0.32, fadeOut: 0.15 });
  });
}

/** Ba số đọc lên như trọng tài đếm xuất phát, khớp với mốc 3 · 2 · 1 */
const WORDS = ["three", "two", "one"] as const;

/**
 * Mỗi mốc đếm ngược: cú trầm + giọng đọc số. "GO" là cú nổ lớn + giọng hô.
 * `step` 0..2 để ba cú trầm cao dần; giọng giữ nguyên cao độ cho tự nhiên.
 * Âm lượng đặt sao cho cộng lại vẫn còn headroom (đỉnh khoảng −2.6 dBFS).
 */
export function countdownHit(last: boolean, step = 0): void {
  if (last) {
    void Promise.all([load("impact"), load("go")]).then(([impact, voice]) => {
      if (impact) startClip(impact, { vol: 0.4 });
      if (voice) startClip(voice, { vol: 0.72 });
    });
    return;
  }
  const word = WORDS[Math.min(step, WORDS.length - 1)];
  void Promise.all([load("tick"), load(word)]).then(([tick, voice]) => {
    if (tick) startClip(tick, { vol: 0.34, rate: 0.88 + step * 0.1 });
    if (voice) startClip(voice, { vol: 0.78 });
  });
}

/**
 * Nhạc chúc mừng khi vào Top 10: chỉ nhạc, hiệu ứng pháo để phần hình lo.
 * Nhạc mở hết âm lượng ngay từ đầu; tiếng cũ (giọng kết ván, tiếng nổ) hạ nhỏ dần.
 */
export async function celebrate(): Promise<void> {
  const seq = ++celebrationSeq;
  duckSfx();
  const buf = await load("celebrate");
  if (!ctx || seq !== celebrationSeq) return;
  if (buf) {
    const src = startClip(buf, { vol: 1, music: true, fadeOut: 1.5 });
    if (src) {
      src.onended = () => {
        if (celebration === src) celebration = null;
        unduckSfx();
      };
      celebration = src;
    }
  }
}

/** Tắt nhạc chúc mừng (đóng popup / chơi ván mới) */
export function stopCelebration(): void {
  celebrationSeq++;
  unduckSfx();
  if (!celebration) return;
  try {
    celebration.stop();
  } catch {
    // source đã phát xong
  }
  celebration = null;
}
