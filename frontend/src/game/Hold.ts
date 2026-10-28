/** Giữ một điều kiện liên tục trong `ms` mili-giây. update() trả về tiến độ 0..1. */
export class Hold {
  private since: number | null = null;
  private readonly ms: number;

  constructor(ms: number) {
    this.ms = ms;
  }

  reset(): void {
    this.since = null;
  }

  update(ok: boolean, now: number): number {
    if (!ok) {
      this.since = null;
      return 0;
    }
    this.since ??= now;
    return Math.min(1, (now - this.since) / this.ms);
  }
}
