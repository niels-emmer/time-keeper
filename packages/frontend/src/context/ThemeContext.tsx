import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  type Theme,
  applyTheme,
  getStoredTheme,
  getSystemTheme,
  resolveTheme,
  setStoredTheme,
} from '@/lib/theme';

interface ThemeContextValue {
  /** The user's stored preference: 'light' | 'dark' | 'system'. */
  theme: Theme;
  /** The actual theme being rendered after resolving 'system'. */
  resolvedTheme: 'light' | 'dark';
  /** Update the preference, persist it, and apply it immediately. */
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolvedTheme: 'dark',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    resolveTheme(getStoredTheme())
  );

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    setStoredTheme(next);
    applyTheme(next);
    setResolvedTheme(resolveTheme(next));
  }, []);

  // Apply stored theme on mount (covers the React-hydration gap; the inline
  // <head> script handles the pre-mount flash).
  useEffect(() => {
    applyTheme(theme);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When the preference is 'system', track OS changes in real time.
  useEffect(() => {
    if (theme !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const sys = getSystemTheme();
      setResolvedTheme(sys);
      applyTheme('system');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Access the current theme and the setter from any component. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
