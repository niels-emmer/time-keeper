# PWA Integration

## Configuration

The frontend is configured as a Progressive Web App using `vite-plugin-pwa` (Workbox).

Key settings in `packages/frontend/vite.config.ts`:

- `display: 'standalone'` — removes browser chrome on both macOS and Android when installed
- `registerType: 'autoUpdate'` — users get new versions without clearing cache
- API routes (`/api/*`) are `NetworkOnly` — never cached; the app requires connectivity
- Static assets are precached by Workbox (Vite build output)

## Installing on Android (Chrome)

1. Open the app URL in Chrome on Android.
2. Tap the three-dot menu (⋮) in the top right.
3. Tap **"Add to Home screen"** or **"Install app"**.
4. Confirm. The app icon appears on your home screen.
5. Opening from the home screen launches in standalone mode (no browser chrome).

## Installing on macOS (Safari)

1. Open the app URL in Safari.
2. Click **File → Add to Dock** (macOS Sonoma+) or **Share → Add to Home Screen**.
3. Confirm. The app appears in your Dock.

### macOS via Chrome/Chromium

1. Open the app URL in Chrome.
2. Click the install icon (⊕) in the address bar, or go to **⋮ → Save and share → Create Shortcut**.
3. Check "Open as window".
4. The app opens in a standalone window without browser chrome.

## Icons

| File | Size | Purpose |
|------|------|---------|
| `public/icon-192.png` | 192×192 | Standard PWA icon |
| `public/icon-512.png` | 512×512 | High-res icon; also used as maskable for Android adaptive icons |
| `public/favicon.ico` | 32×32 | Browser tab icon |

The `purpose: 'any maskable'` on the 512px icon tells Android to apply the adaptive icon mask (rounded square, circle, etc.) depending on the launcher. The icon design has sufficient padding for all common mask shapes.

## Theme color

`theme_color: '#0f172a'` (Tailwind `slate-900`) matches the app's dark navigation bar color, preventing a visual gap in the Android status bar area when using standalone mode.

## Service worker update flow

The app uses `registerType: 'autoUpdate'`. When a new version is deployed:
1. The service worker detects the update on next app open or background sync.
2. It downloads and activates the new version automatically.
3. The next navigation within the app shows the new version.

No manual cache clearing is needed by the user.
