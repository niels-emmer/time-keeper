/**
 * jsdom environment shim for Node 26.
 *
 * Node 26 defines a global `localStorage` accessor that returns `undefined`
 * unless the process was started with `--localstorage-file`. Vitest's jsdom
 * environment only copies a jsdom window key onto `globalThis` when that key
 * does not already exist there (`node_modules/vitest` → `getWindowKeys`), so
 * Node's accessor wins and `window.localStorage` is `undefined` inside tests.
 *
 * The environment also sets `jsdom.url` (see `vitest.config.ts`) so jsdom's
 * Storage objects exist in the first place — jsdom throws on `localStorage`
 * for an opaque origin. This file then points the globals at jsdom's real
 * Storage instances rather than a hand-rolled fake.
 */

interface JsdomGlobal {
  jsdom?: { window: Window };
}

const jsdomWindow = (globalThis as JsdomGlobal).jsdom?.window;

if (jsdomWindow) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    if (!globalThis[key]) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        get: () => jsdomWindow[key],
      });
    }
  }
}
