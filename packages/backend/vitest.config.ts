import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `db/client.ts` opens the database at import time. Tests import route and
    // service modules that pull it in transitively, so without this they would
    // create — and potentially write to — `./dev-data/time-keeper.db`.
    env: {
      DATABASE_PATH: ':memory:',
    },
  },
});
