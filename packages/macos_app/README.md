# Time Keeper — macOS Status Bar App

A native macOS menu-bar app for [Time Keeper](../). Track time without opening a browser — the app lives in your macOS menu bar.

## Features

- **Three-state tray icon**: grey (not connected), monochrome (connected, no timer), colored dot (active timer — uses the category's color)
- **Active timer display**: tray title shows `CODE hh:mm` next to the icon while a timer runs
- **Right-click context menu**: start a timer for any category or stop the active one, without opening the panel
- **Popover panel** (click the icon):
  - **Track tab** — category grid; tap to start/stop timers
  - **Weekly tab** — hours by category × day; copy to clipboard for Workday
  - **Settings tab** — weekly goal, rounding increment, disconnect

## Prerequisites

1. [Flutter SDK 3.19+](https://docs.flutter.dev/get-started/install/macos) with macOS desktop support enabled
2. A running Time Keeper backend with the `api.*` subdomain configured (see [docs/integration/api-subdomain.md](../../docs/integration/api-subdomain.md))
3. A personal access token created in the Time Keeper web app: **Settings → Personal Access Tokens → New token**

## Build & run

```bash
# From repo root
cd packages/macos_app

# Install dependencies
flutter pub get

# Generate tray icon assets first (see assets/tray/README.md)

# Run in debug mode
flutter run -d macos

# Build a release .app
flutter build macos --release
# Output: build/macos/Build/Products/Release/Time Keeper.app
```

## First run

On first launch the app shows a setup screen. Enter:
- **API URL** — `https://api.timekeeper.yourdomain.com`
- **Access token** — the token you generated in the web app

Credentials are stored in macOS Keychain (via `flutter_secure_storage`). To disconnect, open Settings tab → Disconnect.

## Architecture

```
lib/
  main.dart                # App entry; tray icon + window management
  providers/
    app_state.dart         # Connection, timer state, category list (polls every 5s)
    settings_provider.dart # Weekly goal + rounding from the API
  services/
    api_service.dart       # HTTP client for all API calls
    secure_storage.dart    # Keychain wrapper (API URL + token)
    icon_generator.dart    # Generates colored PNG tray icons at runtime
  screens/
    setup_screen.dart      # First-run credential entry
    main_panel.dart        # Three-tab popover shell
  tabs/
    track_tab.dart         # Category grid + active timer
    weekly_tab.dart        # Weekly summary table + copy
    settings_tab.dart      # Settings + disconnect
```

## NPM / subdomain setup

The app connects directly to the backend (bypassing the Authentik proxy). You need:

1. A new NPM proxy host: `api.timekeeper.yourdomain.com`
2. Forward to your server's `127.0.0.1:38522` (or LAN IP if NPM is on a different host)
3. **No Authentik forward auth** — the backend validates the Bearer token itself
4. Force HTTPS + HSTS

See [docs/integration/api-subdomain.md](../../docs/integration/api-subdomain.md) for step-by-step NPM instructions.
