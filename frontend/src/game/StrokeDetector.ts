export type Reversal = "bottom" | "top" | null;

/**
 * Bộ phát hiện nhát (hysteresis theo một trục). y tăng = đi xuống.
 * Một nhát = xuống rồi lên, được đếm tại điểm đảo chiều ở đáy ("bottom").
 */
export class StrokeDetector {
  private dir: -1 | 0 | 1 = 0;
  private ext: number | null = null;

  reset(): void {
    this.dir = 0;
    this.ext = null;
  }

  push(y: number, thr: number): Reversal {
    if (this.ext === null) {
      this.ext = y;
      return null;
    }
    if (this.dir === 0) {
      if (y - this.ext > thr) {
        this.dir = 1;
        this.ext = y;
      } else if (this.ext - y > thr) {
        this.dir = -1;
        this.ext = y;
      }
      return null;
    }
    if (this.dir === 1) {
      if (y > this.ext) this.ext = y;
      else if (this.ext - y > thr) {
        this.dir = -1;
        this.ext = y;
        return "bottom";
      }
    } else if (y < this.ext) this.ext = y;
    else if (y - this.ext > thr) {
      this.dir = 1;
      this.ext = y;
      return "top";
    }
    return null;
  }
}
