/** "short": turned around at the bottom, but the hand had not travelled far enough to score */
export type Reversal = "bottom" | "short" | "top" | null;

/**
 * Bộ phát hiện nhát (hysteresis theo một trục). y tăng = đi xuống.
 * Một nhát = xuống rồi lên, được đếm tại điểm đảo chiều ở đáy ("bottom").
 * `thr` only decides when the hand has turned around; a stroke scores when the way down
 * (top turning point → bottom turning point) is at least `minTravel`, otherwise it is "short".
 * Travel is measured on `raw` (the unsmoothed position, defaults to `y`).
 */
export class StrokeDetector {
  private dir: -1 | 0 | 1 = 0;
  private ext: number | null = null;
  private lo = 0; // raw extremes of the current leg: `lo` on the way up is where the next way down starts
  private hi = 0;
  private top = 0; // raw position where the current way down started
  /** Travel of the latest way down (set at every bottom turning point) */
  lastTravel = 0;

  reset(): void {
    this.dir = 0;
    this.ext = null;
  }

  push(y: number, thr: number, minTravel = 0, raw = y): Reversal {
    if (this.ext === null) {
      this.ext = y;
      this.lo = this.hi = raw;
      return null;
    }
    this.lo = Math.min(this.lo, raw);
    this.hi = Math.max(this.hi, raw);
    if (this.dir === 0) {
      if (y - this.ext > thr) {
        this.dir = 1;
        this.top = this.lo;
        this.hi = raw;
        this.ext = y;
      } else if (this.ext - y > thr) {
        this.dir = -1;
        this.ext = y;
        this.lo = raw;
      }
      return null;
    }
    if (this.dir === 1) {
      if (y > this.ext) this.ext = y;
      else if (this.ext - y > thr) {
        const travel = this.hi - this.top;
        this.lastTravel = travel;
        this.dir = -1;
        this.ext = y;
        this.lo = raw;
        return travel >= minTravel ? "bottom" : "short";
      }
    } else if (y < this.ext) this.ext = y;
    else if (y - this.ext > thr) {
      this.dir = 1;
      this.top = this.lo;
      this.hi = raw;
      this.ext = y;
      return "top";
    }
    return null;
  }
}
