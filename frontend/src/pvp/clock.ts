/**
 * Server clock estimate from ping/pong samples (NTP-style): the sample with the shortest round
 * trip is the most accurate, its offset is server − (sent + rtt / 2).
 */
export class ClockSync {
  private best: { rtt: number; offset: number } | null = null;

  add(sentAt: number, receivedAt: number, serverTime: number): void {
    const rtt = receivedAt - sentAt;
    if (rtt < 0) return;
    if (!this.best || rtt <= this.best.rtt) this.best = { rtt, offset: serverTime - (sentAt + rtt / 2) };
  }

  get ready(): boolean {
    return this.best !== null;
  }

  get rtt(): number | null {
    return this.best?.rtt ?? null;
  }

  /** server ms → local Date.now() ms */
  toLocal(serverTime: number): number {
    return serverTime - (this.best?.offset ?? 0);
  }
}
