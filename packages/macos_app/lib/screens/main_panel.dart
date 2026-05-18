import 'package:flutter/material.dart';
import 'package:macos_ui/macos_ui.dart';
import 'package:provider/provider.dart';
import '../providers/app_state.dart' as app_state;
import '../tabs/track_tab.dart';
import '../tabs/weekly_tab.dart';
import '../tabs/settings_tab.dart';

/// The main popover panel — three tabs: Track, Weekly, Settings.
class MainPanel extends StatefulWidget {
  const MainPanel({super.key});

  @override
  State<MainPanel> createState() => _MainPanelState();
}

class _MainPanelState extends State<MainPanel> {
  late final MacosTabController _controller;

  @override
  void initState() {
    super.initState();
    _controller = MacosTabController(initialIndex: 0, length: 3);
    _controller.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<app_state.AppStateProvider>();
    final cs = Theme.of(context).colorScheme;

    final isAuthError =
        appState.connection == app_state.ConnectionState.authError;

    return Column(
      children: [
        if (isAuthError)
          Container(
            width: double.infinity,
            color: cs.errorContainer,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Text(
              'Token invalid or expired — reconnect in Settings.',
              style: TextStyle(fontSize: 12, color: cs.onErrorContainer),
            ),
          ),

        // macOS segmented control tab bar
        Container(
          color: cs.surface,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          child: Center(
            child: MacosSegmentedControl(
              controller: _controller,
              tabs: const [
                MacosTab(label: 'Track'),
                MacosTab(label: 'Weekly'),
                MacosTab(label: 'Settings'),
              ],
            ),
          ),
        ),
        Divider(
          height: 1,
          thickness: 0.5,
          color: cs.outlineVariant,
        ),

        // Tab content
        Expanded(
          child: IndexedStack(
            index: _controller.index,
            children: const [
              TrackTab(),
              WeeklyTab(),
              SettingsTab(),
            ],
          ),
        ),
      ],
    );
  }
}
