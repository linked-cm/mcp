import { RateLimit } from '../src/backend/rateLimit';

describe('RateLimit', () => {
  it('allows the limit per minute, per key, and again a minute later', () => {
    let now = 0;
    const limit = new RateLimit(2, () => now);
    expect([limit.take('a'), limit.take('a'), limit.take('a')]).toEqual([true, true, false]);
    expect(limit.take('b')).toBe(true);
    now = 59_999;
    expect(limit.take('a')).toBe(false);
    now = 60_001;
    expect(limit.take('a')).toBe(true);
  });
});
