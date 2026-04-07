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
    final isAuthError =
        appState.connection == app_state.ConnectionState.authError;

    return Column(
      children: [
        if (isAuthError)
          Container(
            width: double.infinity,
            color: Theme.of(context).colorScheme.errorContainer,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Text(
              'Token invalid or expired — reconnect in Settings.',
              style: TextStyle(
                  fontSize: 12,
                  color: Theme.of(context).colorScheme.onErrorContainer),
            ),
          ),

        // Top tab bar
        _TopTabBar(
          selectedIndex: _tab,
          onTap: (i) => setState(() => _tab = i),
        ),
        Divider(
          height: 1,
          thickness: 0.5,
          color: Theme.of(context).colorScheme.outlineVariant,
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
      ],
    );
  }
}

class _TopTabBar extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onTap;

  const _TopTabBar({required this.selectedIndex, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      color: cs.surface,
      child: SizedBox(
        height: 36,
        child: Row(
          children: [
            _TabItem(
              label: 'Track',
              selected: selectedIndex == 0,
              onTap: () => onTap(0),
            ),
            _TabItem(
              label: 'Weekly',
              selected: selectedIndex == 1,
              onTap: () => onTap(1),
            ),
            _TabItem(
              label: 'Settings',
              selected: selectedIndex == 2,
              onTap: () => onTap(2),
            ),
          ],
        ),
      ),
    );
  }
}

class _TabItem extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _TabItem({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final textColor = selected ? cs.primary : cs.onSurfaceVariant;

    return Expanded(
      child: InkWell(
        onTap: onTap,
        splashColor: Colors.transparent,
        highlightColor: Colors.transparent,
        child: Center(
          child: Stack(
            alignment: Alignment.bottomCenter,
            children: [
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 13,
                    color: textColor,
                    fontWeight:
                        selected ? FontWeight.w600 : FontWeight.normal,
                  ),
                ),
              ),
              if (selected)
                Positioned(
                  bottom: 0,
                  left: 8,
                  right: 8,
                  child: Container(
                    height: 2,
                    decoration: BoxDecoration(
                      color: cs.primary,
                      borderRadius: BorderRadius.circular(1),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
