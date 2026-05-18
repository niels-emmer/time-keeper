import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
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
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<app_state.AppStateProvider>();
    final cs = Theme.of(context).colorScheme;

    final isAuthError =
        appState.connection == app_state.ConnectionState.authError;

    return Material(
      color: cs.surface,
      child: Column(
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

          // macOS-style segmented control tab bar
          Container(
            color: cs.surface,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: CupertinoSlidingSegmentedControl<int>(
              groupValue: _tab,
              onValueChanged: (v) => setState(() => _tab = v!),
              children: const {
                0: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 8),
                  child: Text('Track', style: TextStyle(fontSize: 13)),
                ),
                1: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 8),
                  child: Text('Weekly', style: TextStyle(fontSize: 13)),
                ),
                2: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 8),
                  child: Text('Settings', style: TextStyle(fontSize: 13)),
                ),
              },
            ),
          ),
          Divider(height: 1, thickness: 0.5, color: cs.outlineVariant),

          // Tab content
          Expanded(
            child: IndexedStack(
              index: _tab,
              children: const [
                TrackTab(),
                WeeklyTab(),
                SettingsTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
