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

    // Show auth error banner if token is no longer valid
    final isAuthError = appState.connection == app_state.ConnectionState.authError;

    return Column(
      children: [
        if (isAuthError)
          Container(
            width: double.infinity,
            color: Colors.red.shade50,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: const Text(
              'Token invalid or expired — reconnect in Settings.',
              style: TextStyle(fontSize: 12, color: Colors.red),
            ),
          ),

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

        // Bottom tab bar
        const Divider(height: 1),
        _BottomTabBar(
          selectedIndex: _tab,
          onTap: (i) => setState(() => _tab = i),
        ),
      ],
    );
  }
}

class _BottomTabBar extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onTap;

  const _BottomTabBar({required this.selectedIndex, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 44,
      child: Row(
        children: [
          _Tab(icon: Icons.access_time, label: 'Track', selected: selectedIndex == 0, onTap: () => onTap(0)),
          _Tab(icon: Icons.calendar_view_week, label: 'Weekly', selected: selectedIndex == 1, onTap: () => onTap(1)),
          _Tab(icon: Icons.settings_outlined, label: 'Settings', selected: selectedIndex == 2, onTap: () => onTap(2)),
        ],
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _Tab({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = selected
        ? Theme.of(context).colorScheme.primary
        : Colors.black38;

    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 18, color: color),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 10,
                color: color,
                fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
