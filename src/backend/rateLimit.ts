/** Calls per key in a sliding minute. In memory: one process. */
export class RateLimit {
  private readonly seen = new Map<string, number[]>();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Count a call for `key`; false when it is over the limit (the call is not counted). */
  take(key: string): boolean {
    const now = this.now();
    const recent = (this.seen.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.perMinute) {
      this.seen.set(key, recent);
      return false;
    }
    recent.push(now);
    this.seen.set(key, recent);
    return true;
  }
}
