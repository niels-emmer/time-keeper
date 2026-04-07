import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
// Alias to avoid naming conflict with Flutter's built-in ConnectionState enum
import '../providers/app_state.dart' as app_state;
import '../providers/settings_provider.dart';
import '../services/api_service.dart';

class SettingsTab extends StatefulWidget {
  const SettingsTab({super.key});

  @override
  State<SettingsTab> createState() => _SettingsTabState();
}

class _SettingsTabState extends State<SettingsTab> {
  bool _disconnecting = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final api = context.read<app_state.AppStateProvider>().api;
      if (api != null) context.read<SettingsProvider>().load(api);
    });
  }

  Future<void> _disconnect() async {
    setState(() => _disconnecting = true);
    await context.read<app_state.AppStateProvider>().disconnect();
    if (mounted) setState(() => _disconnecting = false);
  }

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<app_state.AppStateProvider>();
    final settingsProv = context.watch<SettingsProvider>();

    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        const _SectionHeader('Connection'),
        _ConnectionCard(appState: appState),
        const SizedBox(height: 16),

        if (settingsProv.settings != null) ...[
          const _SectionHeader('Work week'),
          _WorkWeekCard(
            initial: settingsProv.settings!,
            onSave: (s) {
              final api = appState.api;
              if (api != null) context.read<SettingsProvider>().update(api, s);
            },
          ),
          const SizedBox(height: 16),
        ],

        const _SectionHeader('Account'),
        Card(
          child: ListTile(
            dense: true,
            title: const Text('Disconnect', style: TextStyle(fontSize: 13, color: Colors.red)),
            subtitle: const Text(
              'Removes the stored token from Keychain.',
              style: TextStyle(fontSize: 11),
            ),
            trailing: _disconnecting
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.logout, size: 18, color: Colors.red),
            onTap: _disconnecting ? null : _disconnect,
          ),
        ),
      ],
    );
  }
}

// ── Sub-widgets ───────────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(
          title,
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: Colors.black45,
            letterSpacing: 0.5,
          ),
        ),
      );
}

class _ConnectionCard extends StatelessWidget {
  final app_state.AppStateProvider appState;
  const _ConnectionCard({required this.appState});

  @override
  Widget build(BuildContext context) {
    final isOk = appState.isConnected;
    final isError = appState.connection == app_state.ConnectionState.error ||
        appState.connection == app_state.ConnectionState.authError;
    final dotColor = isOk
        ? Colors.green
        : (isError ? Colors.red : Colors.orange);
    final label = isOk
        ? 'Connected'
        : (isError ? 'Error' : 'Connecting…');

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.circle, size: 8, color: dotColor),
                const SizedBox(width: 6),
                Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
              ],
            ),
            if (appState.connectionError.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                appState.connectionError,
                style: const TextStyle(fontSize: 11, color: Colors.red),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _WorkWeekCard extends StatefulWidget {
  final UserSettings initial;
  final void Function(UserSettings) onSave;

  const _WorkWeekCard({required this.initial, required this.onSave});

  @override
  State<_WorkWeekCard> createState() => _WorkWeekCardState();
}

class _WorkWeekCardState extends State<_WorkWeekCard> {
  late int _goalHours;
  late int _rounding;

  @override
  void initState() {
    super.initState();
    _goalHours = widget.initial.weeklyGoalHours;
    _rounding = widget.initial.roundingIncrementMinutes;
  }

  void _save() {
    widget.onSave(UserSettings(
      weeklyGoalHours: _goalHours,
      roundingIncrementMinutes: _rounding,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Weekly goal', style: TextStyle(fontSize: 13)),
                Text(
                  '${_goalHours}h',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                ),
              ],
            ),
            Slider(
              value: _goalHours.toDouble(),
              min: 0,
              max: 40,
              divisions: 40,
              onChanged: (v) => setState(() => _goalHours = v.round()),
              onChangeEnd: (_) => _save(),
            ),
            const SizedBox(height: 8),
            const Text('Rounding increment', style: TextStyle(fontSize: 13)),
            const SizedBox(height: 6),
            Row(
              children: [
                _ToggleButton('30 min', _rounding == 30, () {
                  setState(() => _rounding = 30);
                  _save();
                }),
                const SizedBox(width: 8),
                _ToggleButton('60 min', _rounding == 60, () {
                  setState(() => _rounding = 60);
                  _save();
                }),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ToggleButton extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _ToggleButton(this.label, this.selected, this.onTap);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? Theme.of(context).colorScheme.primary : Colors.transparent,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color: selected
                ? Theme.of(context).colorScheme.primary
                : Colors.grey.shade300,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: selected ? Colors.white : Colors.black87,
            fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
          ),
        ),
      ),
    );
  }
}
