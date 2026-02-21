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

All icons live under `packages/frontend/public/icons/`.

| File | Size | Purpose |
|------|------|---------|
| `icons/icon-192x192.png` | 192×192 | Standard PWA icon |
| `icons/icon-512x512.png` | 512×512 | High-res PWA icon |
| `icons/maskable-192x192.png` | 192×192 | Android adaptive icon (maskable) |
| `icons/maskable-512x512.png` | 512×512 | Android adaptive icon, high-res (maskable) |
| `icons/apple-touch-icon.png` | 180×180 | iOS home screen icon |
| `icons/favicon.ico` | 32×32 | Browser tab icon |

Maskable icons have sufficient padding for all common launcher mask shapes (rounded square, circle, etc.).

## Theme colour

The browser chrome colour adapts to the active colour scheme via two `<meta name="theme-color">` tags in `index.html`:

```html
<meta name="theme-color" content="#f3f6fb" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0B1220" media="(prefers-color-scheme: dark)" />
```

The PWA manifest `theme_color` is set to `#4f5aea` (the primary brand colour), which applies when the app is installed and the browser reads the manifest. See [D-014 in decisions.md](../memory/decisions.md) for the full rationale.

## Service worker update flow

The app uses `registerType: 'autoUpdate'`. When a new version is deployed:
1. The service worker detects the update on next app open or background sync.
2. It downloads and activates the new version automatically.
3. The next navigation within the app shows the new version.

No manual cache clearing is needed by the user. See [RB-004 in runbooks.md](../operations/runbooks.md) for force-clearing if needed.
