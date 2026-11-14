import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the TypeScript sources. A prior `tsc` build emits compiled
    // `dist/**/*.test.js`, which Vitest's default glob would also collect and
    // run a second time.
    include: ['src/**/*.test.ts'],
    // `db/client.ts` opens the database at import time. Tests import route and
    // service modules that pull it in transitively, so without this they would
    // create — and potentially write to — `./dev-data/time-keeper.db`.
    env: {
      DATABASE_PATH: ':memory:',
    },
  },
});
