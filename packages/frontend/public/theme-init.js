/**
 * Pre-paint theme bootstrap.
 *
 * Runs synchronously from <head> before the app bundle so the stored theme is
 * applied without a flash of the wrong colours (D-014). It lives in a
 * same-origin file rather than an inline <script> so the production CSP can
 * keep `script-src 'self'` with no 'unsafe-inline' and no hash maintenance
 * (finding M-1).
 */
(function () {
  try {
    var stored = localStorage.getItem('time-keeper-theme');
    var dark =
      stored === 'dark' ||
      (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch {
    // Storage blocked (private mode / hardened browser): keep the CSS default.
  }
})();
