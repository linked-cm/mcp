import { defineConfig } from 'vitest/config';

// The live check: a real Claude model drives the endpoint. Run with `npm run live-check`;
// never part of `npm test`. Needs ANTHROPIC_API_KEY in `.env.local` (git-ignored).
export default defineConfig({
  test: { environment: 'node', globals: true, include: ['tests/live/**/*.live.ts'], testTimeout: 300_000 },
});
