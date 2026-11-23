/** Damped spring, integrated in small fixed steps so a slow camera frame cannot blow it up. */
class Spring {
  x = 0;
  v = 0;
  private readonly k: number;
  private readonly c: number;

  constructor(freqHz: number, damping: number) {
    const w = 2 * Math.PI * freqHz;
    this.k = w * w;
    this.c = 2 * damping * w;
  }

  step(target: number, dt: number): void {
    const n = Math.max(1, Math.ceil(dt / STEP_S));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.k * (this.x - target) - this.c * this.v) * h;
      this.x += this.v * h;
    }
  }

  reset(x = 0): void {
    this.x = x;
    this.v = 0;
  }
}

const STEP_S = 0.004;
const MAX_DT_S = 0.1; // a longer gap (tab hidden, camera stalled) just resumes from where it was
const KICK_BOTTOM = 9.8; // width velocity added by a counted stroke (1/s)
const KICK_TOP = 4.9;
const BULGE_BASE = 0.45; // extra half-width at the bulge, as a share of the rod's half-width
const BULGE_SPEED = 0.3; // added on top at full hand speed
const BULGE_FULL_SPEED = 18; // hand speed (rod scales per second) that counts as full
const PULSE_LIMIT = 0.6;
const FLASH_MS = 220;

/**
 * Rubber look of one rod: purely visual, never read by the stroke counter or the on-rod check.
 * `pulse` squashes the whole rod on every stroke, `bulge` is a lump that chases the hand and overshoots.
 * Positions are in frame heights, like HandTrack.smooth.
 */
export class RodFx {
  private readonly pulseSpring = new Spring(5, 0.22);
  private readonly lagSpring = new Spring(6.5, 0.3);
  private lastAt: number | null = null;
  private scoredAt = -Infinity;

  /** Whole-rod squash: width × (1 + pulse), length shrinks a little to match */
  get pulse(): number {
    return Math.max(-PULSE_LIMIT, Math.min(PULSE_LIMIT, this.pulseSpring.x));
  }

  /** Where the lump sits along the rod */
  get bulgeAt(): number {
    return this.lagSpring.x;
  }

  /** Lump height (share of the half-width): bigger when the hand moves fast. `scale` = rodScale(anchor) */
  bulgeAmp(scale: number): number {
    const speed = Math.min(1, Math.abs(this.lagSpring.v) / (BULGE_FULL_SPEED * scale));
    return BULGE_BASE + BULGE_SPEED * speed;
  }

  kick(rev: "bottom" | "top"): void {
    this.pulseSpring.v += rev === "bottom" ? KICK_BOTTOM : KICK_TOP;
  }

  /** A stroke just scored: flash the rod */
  score(now: number): void {
    this.scoredAt = now;
  }

  /** Score flash, 1 right after a counted stroke fading to 0 */
  flash(now: number): number {
    return Math.max(0, Math.min(1, 1 - (now - this.scoredAt) / FLASH_MS));
  }

  /** New rod (random mode): forget the old motion and pop in */
  spawn(): void {
    this.pulseSpring.reset();
    this.lagSpring.reset();
    this.pulseSpring.v = KICK_BOTTOM;
  }

  /** Advance to `now` (ms). `along` = hand position along the rod, null when the hand is lost. */
  update(along: number | null, now: number): void {
    const dt = this.lastAt === null ? 0 : Math.min(MAX_DT_S, Math.max(0, (now - this.lastAt) / 1000));
    this.lastAt = now;
    if (!dt) return;
    this.pulseSpring.step(0, dt);
    this.lagSpring.step(along ?? 0, dt);
  }
}
