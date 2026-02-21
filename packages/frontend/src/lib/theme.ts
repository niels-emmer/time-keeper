/**
 * Theme utilities — pure functions for reading/writing the user's theme
 * preference and applying it to the document.
 *
 * Theme preference is stored in localStorage under STORAGE_KEY.
 * The resolved theme ('light' | 'dark') is applied by adding/removing the
 * `.dark` class on <html> — Tailwind's `darkMode: ['class']` strategy.
 */

export type Theme = 'light' | 'dark' | 'system';

export const STORAGE_KEY = 'time-keeper-theme';

/** Read the stored preference; defaults to 'system' if absent or invalid. */
export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // localStorage unavailable (e.g. private browsing restrictions)
  }
  return 'system';
}

/** Persist the preference to localStorage. */
export function setStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore write failures
  }
}

/** Resolve what the OS currently prefers. */
export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Apply a theme to the document by toggling the `.dark` class on <html>.
 * Safe to call before React mounts (used in the inline <head> script too).
 */
export function applyTheme(theme: Theme): void {
  const resolved = theme === 'system' ? getSystemTheme() : theme;
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

/** Resolve a Theme value to 'light' | 'dark'. */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? getSystemTheme() : theme;
}
