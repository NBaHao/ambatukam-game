// Tiếng bíp tổng hợp bằng Web Audio + giọng đọc. AudioContext chỉ tạo được sau thao tác của người dùng.
let ctx: AudioContext | null = null;

export function initAudio(): void {
  ctx ??= new AudioContext();
  void ctx.resume();
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

export function say(text: string): void {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.9;
  u.pitch = 0.6;
  speechSynthesis.speak(u);
}
