// Tiếng bíp tổng hợp bằng Web Audio + giọng đọc. AudioContext chỉ tạo được sau thao tác của người dùng.
let ctx: AudioContext | null = null;
let voice: SpeechSynthesisVoice | null = null;

const hasSpeech = () => "speechSynthesis" in window;

// Ưu tiên giọng Indonesia: meme nổi lên ở TikTok Indonesia, và đọc "Ambatukam" đúng như viết
function pickVoice(): void {
  const voices = speechSynthesis.getVoices();
  voice = voices.find((v) => v.lang.startsWith("id")) ?? null;
}

export function initAudio(): void {
  ctx ??= new AudioContext();
  void ctx.resume();
  if (hasSpeech() && !voice) {
    pickVoice();
    speechSynthesis.addEventListener("voiceschanged", pickVoice, { once: true });
    // iOS chỉ cho đọc nếu lần đọc đầu tiên nằm trong thao tác của người dùng
    speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  }
}

export function beep(freq: number, ms = 60, vol = 0.08, type: OscillatorType = "square"): void {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + ms / 1000);
}

/** Một nốt trượt tần số: from → to (Hz) trong ms */
function slide(from: number, to: number, ms: number, vol: number, type: OscillatorType, at = 0): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + at / 1000;
  const t1 = t0 + ms / 1000;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t0);
  o.frequency.exponentialRampToValueAtTime(to, t1);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t1);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t1);
}

/** Tiếng xì (nhiễu trắng qua lọc) */
function noise(ms: number, vol: number, filterFrom: number, filterTo: number): void {
  if (!ctx) return;
  const len = Math.ceil((ctx.sampleRate * ms) / 1000);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const g = ctx.createGain();
  const t1 = ctx.currentTime + ms / 1000;
  src.buffer = buf;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(filterFrom, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(filterTo, t1);
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, t1);
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start();
}

/** Tiếng nổ lúc "KAM!": trống trầm + xì + chuông */
function boom(): void {
  slide(140, 38, 600, 0.5, "sine");
  noise(350, 0.25, 3000, 200);
  slide(1760, 1760, 500, 0.06, "triangle", 60);
}

interface Syllable {
  text: string;
  pitch: number;
  rate: number;
}

// Giọng Indonesia đọc đúng chính tả; giọng tiếng Anh cần viết theo cách phát âm
const SYLLABLES_ID = ["Am", "ba", "tu", "kam!"];
const SYLLABLES_EN = ["Ahm", "bah", "too", "kahm!"];

/** Đọc lần lượt từng âm tiết, giọng cao dần; onLast chạy khi bắt đầu đọc âm cuối */
function chant(parts: Syllable[], onLast?: () => void): void {
  if (!hasSpeech()) {
    onLast?.();
    return;
  }
  speechSynthesis.cancel();
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p.text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "en-US";
    u.pitch = p.pitch;
    u.rate = p.rate;
    if (i === parts.length - 1 && onLast) u.onstart = onLast;
    speechSynthesis.speak(u);
  });
}

function syllables(): string[] {
  return voice ? SYLLABLES_ID : SYLLABLES_EN;
}

/** "Am… ba… tu… KAM!": tiếng rít tăng dần, tới "KAM" thì nổ */
export function ambatukam(): void {
  const [am, ba, tu, kam] = syllables();
  slide(120, 900, 1800, 0.05, "sawtooth");
  chant(
    [
      { text: am, pitch: 0.7, rate: 0.6 },
      { text: ba, pitch: 0.9, rate: 0.6 },
      { text: tu, pitch: 1.1, rate: 0.6 },
      { text: kam, pitch: 1.6, rate: 1.1 },
    ],
    boom,
  );
}

/** "Am… ba… tu…" rồi xịt: suýt tới mà không tới */
export function ambatu(): void {
  const [am, ba, tu] = syllables();
  chant(
    [
      { text: am, pitch: 0.8, rate: 0.6 },
      { text: ba, pitch: 1, rate: 0.6 },
      { text: tu, pitch: 1.2, rate: 0.5 },
    ],
    () => slide(700, 140, 900, 0.08, "sine", 500),
  );
}
