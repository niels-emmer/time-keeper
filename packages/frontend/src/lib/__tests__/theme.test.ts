import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STORAGE_KEY,
  applyTheme,
  getStoredTheme,
  getSystemTheme,
  resolveTheme,
  setStoredTheme,
} from '../theme';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal localStorage mock. */
function makeLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
  };
}

// ---------------------------------------------------------------------------
// getStoredTheme
// ---------------------------------------------------------------------------

describe('getStoredTheme', () => {
  let lsMock: ReturnType<typeof makeLocalStorageMock>;

  beforeEach(() => {
    lsMock = makeLocalStorageMock();
    vi.stubGlobal('localStorage', lsMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns "system" when nothing is stored', () => {
    expect(getStoredTheme()).toBe('system');
  });

  it('returns "light" when stored', () => {
    lsMock.setItem(STORAGE_KEY, 'light');
    expect(getStoredTheme()).toBe('light');
  });

  it('returns "dark" when stored', () => {
    lsMock.setItem(STORAGE_KEY, 'dark');
    expect(getStoredTheme()).toBe('dark');
  });

  it('returns "system" when stored', () => {
    lsMock.setItem(STORAGE_KEY, 'system');
    expect(getStoredTheme()).toBe('system');
  });

  it('falls back to "system" for an unrecognised stored value', () => {
    lsMock.setItem(STORAGE_KEY, 'blue');
    expect(getStoredTheme()).toBe('system');
  });

  it('falls back to "system" when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('unavailable');
      },
    });
    expect(getStoredTheme()).toBe('system');
  });
});

// ---------------------------------------------------------------------------
// setStoredTheme
// ---------------------------------------------------------------------------

describe('setStoredTheme', () => {
  let lsMock: ReturnType<typeof makeLocalStorageMock>;

  beforeEach(() => {
    lsMock = makeLocalStorageMock();
    vi.stubGlobal('localStorage', lsMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists each valid theme value', () => {
    for (const t of ['light', 'dark', 'system'] as const) {
      setStoredTheme(t);
      expect(lsMock.getItem(STORAGE_KEY)).toBe(t);
    }
  });

  it('does not throw when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('unavailable');
      },
    });
    expect(() => setStoredTheme('dark')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getSystemTheme
// ---------------------------------------------------------------------------

describe('getSystemTheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns "dark" when prefers-color-scheme is dark', () => {
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: q === '(prefers-color-scheme: dark)' }),
    });
    expect(getSystemTheme()).toBe('dark');
  });

  it('returns "light" when prefers-color-scheme is not dark', () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    });
    expect(getSystemTheme()).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// resolveTheme
// ---------------------------------------------------------------------------

describe('resolveTheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns "light" for "light"', () => {
    expect(resolveTheme('light')).toBe('light');
  });

  it('returns "dark" for "dark"', () => {
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('resolves "system" to the system preference (dark)', () => {
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: q === '(prefers-color-scheme: dark)' }),
    });
    expect(resolveTheme('system')).toBe('dark');
  });

  it('resolves "system" to the system preference (light)', () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    });
    expect(resolveTheme('system')).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// applyTheme  (requires jsdom for document.documentElement)
// ---------------------------------------------------------------------------

describe('applyTheme', () => {
  afterEach(() => {
    // Reset class list between tests
    document.documentElement.classList.remove('dark');
    vi.unstubAllGlobals();
  });

  it('adds "dark" class for theme "dark"', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes "dark" class for theme "light"', () => {
    document.documentElement.classList.add('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('adds "dark" class for theme "system" when OS prefers dark', () => {
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: q === '(prefers-color-scheme: dark)' }),
    });
    applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes "dark" class for theme "system" when OS prefers light', () => {
    document.documentElement.classList.add('dark');
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    });
    applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
