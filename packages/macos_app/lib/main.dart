import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:screen_retriever/screen_retriever.dart';
import 'package:tray_manager/tray_manager.dart';
import 'package:window_manager/window_manager.dart';

import 'providers/app_state.dart' as app_state;
import 'providers/settings_provider.dart';
import 'services/secure_storage.dart';
import 'services/icon_generator.dart';
import 'screens/setup_screen.dart';
import 'screens/main_panel.dart';
import 'screens/splash_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await windowManager.ensureInitialized();

  // Start with the splash window: centered, compact size.
  // After the user dismisses it (or after 5s) we resize + hide and
  // the app lives entirely in the menu bar.
  const splashOptions = WindowOptions(
    size: Size(320, 340),
    minimumSize: Size(280, 300),
    center: true,
    title: 'Time Keeper',
    titleBarStyle: TitleBarStyle.hidden,
    alwaysOnTop: true,
    skipTaskbar: true,
  );
  await windowManager.waitUntilReadyToShow(splashOptions, () async {
    await windowManager.show();
  });

  runApp(const TimeKeeperApp());
}

class TimeKeeperApp extends StatefulWidget {
  const TimeKeeperApp({super.key});

  @override
  State<TimeKeeperApp> createState() => _TimeKeeperAppState();
}

class _TimeKeeperAppState extends State<TimeKeeperApp>
    with TrayListener, WindowListener {
  final _storage = SecureStorageService();
  late final app_state.AppStateProvider _appState;
  late final SettingsProvider _settingsProvider;

  bool _splashDone = false;

  // Track current icon so we only call setIcon when it actually changes
  String? _currentIconAsset;
  String? _currentIconFile;
  String? _currentTitle;

  @override
  void initState() {
    super.initState();
    _appState = app_state.AppStateProvider(_storage);
    _settingsProvider = SettingsProvider();

    trayManager.addListener(this);
    windowManager.addListener(this);

    _initTray();
    _appState.addListener(_onStateChanged);
    _appState.initialise();
  }

  @override
  void dispose() {
    _appState.removeListener(_onStateChanged);
    trayManager.removeListener(this);
    windowManager.removeListener(this);
    _appState.dispose();
    super.dispose();
  }

  // ── Splash dismissal ─────────────────────────────────────────────────────────

  Future<void> _finishSplash() async {
    // Resize to popover dimensions before hiding
    await windowManager.setSize(const Size(380, 560));
    await windowManager.hide();
    setState(() => _splashDone = true);
  }

  // ── Icon management ─────────────────────────────────────────────────────────

  Future<void> _initTray() async {
    await _setGreyIcon();
    await trayManager.setContextMenu(_buildContextMenu());
  }

  Future<void> _setGreyIcon() async {
    if (_currentIconAsset == 'assets/tray/grey.png') return;
    await trayManager.setIcon('assets/tray/grey.png', isTemplate: false);
    await trayManager.setTitle('');
    _currentIconAsset = 'assets/tray/grey.png';
    _currentIconFile = null;
    _currentTitle = '';
  }

  Future<void> _setInactiveIcon() async {
    if (_currentIconAsset == 'assets/tray/inactive.png') return;
    await trayManager.setIcon('assets/tray/inactive.png', isTemplate: true);
    await trayManager.setTitle('');
    _currentIconAsset = 'assets/tray/inactive.png';
    _currentIconFile = null;
    _currentTitle = '';
  }

  Future<void> _setActiveIcon(String hexColor, String title) async {
    if (_currentTitle == title && _currentIconFile != null) return;
    final path = await IconGenerator.coloredDot(hexColor);
    if (path != _currentIconFile) {
      await trayManager.setIcon(path, isTemplate: false);
      _currentIconFile = path;
      _currentIconAsset = null;
    }
    if (title != _currentTitle) {
      await trayManager.setTitle(title);
      _currentTitle = title;
    }
  }

  // ── State → tray update ─────────────────────────────────────────────────────

  void _onStateChanged() {
    _updateTrayIcon();
    _updateContextMenu();
  }

  Future<void> _updateTrayIcon() async {
    switch (_appState.connection) {
      case app_state.ConnectionState.unconfigured:
      case app_state.ConnectionState.connecting:
      case app_state.ConnectionState.error:
      case app_state.ConnectionState.authError:
        await _setGreyIcon();
        return;
      case app_state.ConnectionState.connected:
        break;
    }

    final timer = _appState.timerStatus;
    if (!timer.active || timer.entry == null) {
      await _setInactiveIcon();
      return;
    }

    final cat = _appState.categoryById(timer.entry!.categoryId);
    final color = cat?.color ?? '#6366f1';
    final code = cat?.workdayCode ?? cat?.name ?? '';
    final elapsed = _appState.elapsedHHMM;
    final title = code.isNotEmpty ? '$code $elapsed' : elapsed;

    await _setActiveIcon(color, title);
  }

  Future<void> _updateContextMenu() async {
    await trayManager.setContextMenu(_buildContextMenu());
  }

  Menu _buildContextMenu() {
    final timer = _appState.timerStatus;
    final items = <MenuItem>[];

    if (timer.active && timer.entry != null) {
      final cat = _appState.categoryById(timer.entry!.categoryId);
      items.add(MenuItem(
        label: '⏱ ${cat?.name ?? 'Timer running'} — ${_appState.elapsedHHMM}',
        disabled: true,
      ));
      items.add(MenuItem.separator());
      items.add(MenuItem(
        label: 'Stop timer',
        onClick: (_) => _appState.stopTimer(),
      ));
    } else if (_appState.isConnected && _appState.categories.isNotEmpty) {
      items.add(MenuItem(label: 'Start timer for…', disabled: true));
      for (final cat in _appState.categories.take(8)) {
        items.add(MenuItem(
          label: cat.workdayCode != null
              ? '${cat.name}  (${cat.workdayCode})'
              : cat.name,
          onClick: (_) => _appState.startTimer(cat.id),
        ));
      }
    }

    if (items.isNotEmpty) items.add(MenuItem.separator());

    items.add(MenuItem(
      label: 'Open Time Keeper',
      onClick: (_) => _showWindow(),
    ));
    items.add(MenuItem.separator());
    items.add(MenuItem(
      label: 'Quit',
      onClick: (_) => _quit(),
    ));

    return Menu(items: items);
  }

  // ── Window management ───────────────────────────────────────────────────────

  Future<void> _showWindow() async {
    final isVisible = await windowManager.isVisible();
    if (isVisible) {
      await windowManager.focus();
      return;
    }

    // Position the window near the tray icon (top-right of screen)
    final display = await screenRetriever.getPrimaryDisplay();
    final screenWidth = display.size.width;
    await windowManager.setPosition(Offset(screenWidth - 395, 28));
    await windowManager.show();
    await windowManager.focus();
  }

  Future<void> _quit() async {
    await trayManager.destroy();
    await windowManager.close();
  }

  // ── TrayListener ──────────────────────────────────────────────────────────

  @override
  void onTrayIconMouseDown() {
    _showWindow();
  }

  @override
  void onTrayIconRightMouseDown() {
    trayManager.popUpContextMenu();
  }

  // ── WindowListener ────────────────────────────────────────────────────────

  @override
  void onWindowBlur() {
    // Close the popover when it loses focus (clicking elsewhere),
    // but only once splash is done.
    if (_splashDone) windowManager.hide();
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    ThemeData buildTheme(Brightness b) {
      final isLight = b == Brightness.light;

      // macOS color tokens — never use ColorScheme.fromSeed; accent blue is exact.
      const surfaceLight = Color(0xFFFFFFFF);
      const surfaceContainerLowLight = Color(0xFFF2F2F7);
      const surfaceContainerHighLight = Color(0xFFFFFFFF);
      const outlineVariantLight = Color(0x1A000000);
      const onSurfaceLight = Color(0xD9000000);
      const onSurfaceVariantLight = Color(0x80000000);
      const primaryLight = Color(0xFF007AFF);
      const onPrimaryLight = Color(0xFFFFFFFF);

      const surfaceDark = Color(0xFF1C1C1E);
      const surfaceContainerLowDark = Color(0xFF2C2C2E);
      const surfaceContainerHighDark = Color(0xFF3A3A3C);
      const outlineVariantDark = Color(0x1AFFFFFF);
      const onSurfaceDark = Color(0xE6FFFFFF);
      const onSurfaceVariantDark = Color(0x8CFFFFFF);
      const primaryDark = Color(0xFF0A84FF);
      const onPrimaryDark = Color(0xFFFFFFFF);

      final cs = isLight
          ? const ColorScheme(
              brightness: Brightness.light,
              surface: surfaceLight,
              surfaceContainerLow: surfaceContainerLowLight,
              surfaceContainerHigh: surfaceContainerHighLight,
              outlineVariant: outlineVariantLight,
              onSurface: onSurfaceLight,
              onSurfaceVariant: onSurfaceVariantLight,
              primary: primaryLight,
              onPrimary: onPrimaryLight,
              // required fields — map to sensible macOS equivalents
              secondary: primaryLight,
              onSecondary: onPrimaryLight,
              error: Color(0xFFFF3B30),
              onError: Color(0xFFFFFFFF),
              primaryContainer: Color(0xFFD1E8FF),
              onPrimaryContainer: Color(0xFF001F3F),
              secondaryContainer: Color(0xFFD1E8FF),
              onSecondaryContainer: Color(0xFF001F3F),
              errorContainer: Color(0xFFFFDAD6),
              onErrorContainer: Color(0xFF410002),
              surfaceContainerHighest: surfaceContainerHighLight,
              outline: outlineVariantLight,
              shadow: Color(0x33000000),
              inverseSurface: Color(0xFF2C2C2E),
              onInverseSurface: Color(0xFFFFFFFF),
              inversePrimary: primaryDark,
              scrim: Color(0xFF000000),
              surfaceTint: primaryLight,
            )
          : const ColorScheme(
              brightness: Brightness.dark,
              surface: surfaceDark,
              surfaceContainerLow: surfaceContainerLowDark,
              surfaceContainerHigh: surfaceContainerHighDark,
              outlineVariant: outlineVariantDark,
              onSurface: onSurfaceDark,
              onSurfaceVariant: onSurfaceVariantDark,
              primary: primaryDark,
              onPrimary: onPrimaryDark,
              secondary: primaryDark,
              onSecondary: onPrimaryDark,
              error: Color(0xFFFF453A),
              onError: Color(0xFFFFFFFF),
              primaryContainer: Color(0xFF003060),
              onPrimaryContainer: Color(0xFFD1E8FF),
              secondaryContainer: Color(0xFF003060),
              onSecondaryContainer: Color(0xFFD1E8FF),
              errorContainer: Color(0xFF93000A),
              onErrorContainer: Color(0xFFFFDAD6),
              surfaceContainerHighest: surfaceContainerHighDark,
              outline: outlineVariantDark,
              shadow: Color(0x66000000),
              inverseSurface: Color(0xFFF2F2F7),
              onInverseSurface: Color(0xFF1C1C1E),
              inversePrimary: primaryLight,
              scrim: Color(0xFF000000),
              surfaceTint: primaryDark,
            );

      final outlineVariant = isLight ? outlineVariantLight : outlineVariantDark;

      return ThemeData(
        colorScheme: cs,
        useMaterial3: true,
        dividerColor: outlineVariant,
        dividerTheme: DividerThemeData(
          color: outlineVariant,
          space: 1,
          thickness: 0.5,
        ),
        cardTheme: CardThemeData(
          elevation: 0,
          margin: EdgeInsets.zero,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          color: cs.surfaceContainerLow,
        ),
        listTileTheme: const ListTileThemeData(
          dense: true,
          contentPadding: EdgeInsets.symmetric(horizontal: 14),
        ),
      );
    }

    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: _appState),
        ChangeNotifierProvider.value(value: _settingsProvider),
      ],
      child: MaterialApp(
        title: 'Time Keeper',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(Brightness.light),
        darkTheme: buildTheme(Brightness.dark),
        themeMode: ThemeMode.system,
        home: _splashDone
            ? Consumer<app_state.AppStateProvider>(
                builder: (context, state, _) {
                  if (state.connection ==
                      app_state.ConnectionState.unconfigured) {
                    return const SetupScreen();
                  }
                  return const MainPanel();
                },
              )
            : SplashScreen(onDismiss: _finishSplash),
      ),
    );
  }
}
