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
        _GroupedSection(
          children: [
            InkWell(
              onTap: _disconnecting ? null : _disconnect,
              borderRadius: BorderRadius.circular(10),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                    horizontal: 14, vertical: 12),
                child: Row(
                  children: [
                    Text(
                      'Disconnect',
                      style: TextStyle(
                        fontSize: 13,
                        color: Colors.red.shade400,
                      ),
                    ),
                    const Spacer(),
                    _disconnecting
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child:
                                CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Icon(Icons.logout,
                            size: 16, color: Colors.red.shade400),
                  ],
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

// ── Grouped section ───────────────────────────────────────────────────────────

class _GroupedSection extends StatelessWidget {
  final List<Widget> children;
  const _GroupedSection({required this.children});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: cs.surfaceContainerLow,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (int i = 0; i < children.length; i++) ...[
            children[i],
            if (i < children.length - 1)
              Divider(
                height: 0.5,
                thickness: 0.5,
                indent: 14,
                endIndent: 0,
                color: cs.outlineVariant,
              ),
          ],
        ],
      ),
    );
  }
}

// ── Sub-widgets ───────────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6, left: 2),
        child: Text(
          title.toUpperCase(),
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w500,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
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
    final cs = Theme.of(context).colorScheme;
    final isOk = appState.isConnected;
    final isError = appState.connection == app_state.ConnectionState.error ||
        appState.connection == app_state.ConnectionState.authError;
    final dotColor =
        isOk ? Colors.green : (isError ? Colors.red : Colors.orange);
    final label = isOk ? 'Connected' : (isError ? 'Error' : 'Connecting…');
    final apiHost = Uri.tryParse(appState.apiUrl ?? '')?.host ?? '';

    return _GroupedSection(
      children: [
        Padding(
          padding:
              const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: dotColor,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(label,
                      style: const TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w500)),
                  const Spacer(),
                  if (apiHost.isNotEmpty)
                    Text(
                      apiHost,
                      style: TextStyle(
                          fontSize: 11, color: cs.onSurfaceVariant),
                    ),
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
      ],
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
    final cs = Theme.of(context).colorScheme;
    return _GroupedSection(
      children: [
        // Weekly goal row (label + value + slider stacked)
        Padding(
          padding:
              const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Text('Weekly goal',
                      style: TextStyle(fontSize: 13)),
                  const Spacer(),
                  Text(
                    '${_goalHours}h',
                    style: TextStyle(
                        fontSize: 13, color: cs.onSurfaceVariant),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              SliderTheme(
                data: SliderTheme.of(context).copyWith(
                  trackHeight: 2,
                  overlayShape: SliderComponentShape.noOverlay,
                ),
                child: Slider(
                  value: _goalHours.toDouble(),
                  min: 0,
                  max: 40,
                  divisions: 40,
                  onChanged: (v) =>
                      setState(() => _goalHours = v.round()),
                  onChangeEnd: (_) => _save(),
                ),
              ),
            ],
          ),
        ),
        // Rounding row
        Padding(
          padding:
              const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            children: [
              const Text('Rounding', style: TextStyle(fontSize: 13)),
              const Spacer(),
              Row(
                children: [
                  _ToggleButton('30 min', _rounding == 30, () {
                    setState(() => _rounding = 30);
                    _save();
                  }),
                  const SizedBox(width: 6),
                  _ToggleButton('60 min', _rounding == 60, () {
                    setState(() => _rounding = 60);
                    _save();
                  }),
                ],
              ),
            ],
          ),
        ),
      ],
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
        padding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
        decoration: BoxDecoration(
          color: selected
              ? Theme.of(context).colorScheme.primary
              : Colors.transparent,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color: selected
                ? Theme.of(context).colorScheme.primary
                : Theme.of(context).colorScheme.outlineVariant,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: selected
                ? Theme.of(context).colorScheme.onPrimary
                : Theme.of(context).colorScheme.onSurface,
            fontWeight:
                selected ? FontWeight.w600 : FontWeight.normal,
          ),
        ),
      ),
    );
  }
}
