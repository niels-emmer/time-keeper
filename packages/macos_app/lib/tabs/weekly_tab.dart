import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:macos_ui/macos_ui.dart';
import 'package:provider/provider.dart';

import '../providers/app_state.dart';
import '../services/api_service.dart';
import '../widgets/daily_log_dialog.dart';

/// Returns the ISO week string (YYYY-Www) for the given date.
String _isoWeek(DateTime date) {
  final thursday = date.add(Duration(days: 4 - date.weekday));
  final yearStart = DateTime(thursday.year, 1, 1);
  final weekNum = (thursday.difference(yearStart).inDays / 7).ceil();
  return '${thursday.year}-W${weekNum.toString().padLeft(2, '0')}';
}

/// Returns the Monday of the ISO week containing [date].
DateTime _weekStart(DateTime date) {
  return date.subtract(Duration(days: date.weekday - 1));
}

class WeeklyTab extends StatefulWidget {
  const WeeklyTab({super.key});

  @override
  State<WeeklyTab> createState() => _WeeklyTabState();
}

class _WeeklyTabState extends State<WeeklyTab> {
  DateTime _referenceDate = DateTime.now();
  WeeklySummary? _summary;
  bool _loading = false;
  String? _error;
  bool _copied = false;
  bool _copyHovered = false;
  String? _actionMessage;
  _EditingCell? _editingCell;
  final Map<String, int> _localOverrides = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final api = context.read<AppStateProvider>().api;
    if (api == null) return;

    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final week = _isoWeek(_referenceDate);
      final summary = await api.getWeeklySummary(week);
      if (!mounted) return;
      setState(() {
        _summary = summary;
        _editingCell = null;
        _localOverrides.clear();
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Failed to load: ${e.toString()}';
      });
      debugPrint('Weekly tab error: $e');
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  void _prevWeek() {
    setState(() {
      _referenceDate = _referenceDate.subtract(const Duration(days: 7));
      _editingCell = null;
      _localOverrides.clear();
      _actionMessage = null;
    });
    _load();
  }

  void _nextWeek() {
    final next = _referenceDate.add(const Duration(days: 7));
    if (next.isAfter(DateTime.now())) return;
    setState(() {
      _referenceDate = next;
      _editingCell = null;
      _localOverrides.clear();
      _actionMessage = null;
    });
    _load();
  }

  void _copyToClipboard() {
    final summary = _summary;
    final categories = context.read<AppStateProvider>().categories;
    if (summary == null) return;

    final totals = _computedTotalsByCategory(summary);
    final lines = <String>[];
    for (final category in categories) {
      final total = totals[category.id] ?? 0;
      if (total == 0) continue;
      final hours = _fmtHours(total.toDouble());
      final code =
          category.workdayCode != null ? '${category.workdayCode}\t' : '';
      lines.add('$code${category.name}\t$hours');
    }

    Clipboard.setData(ClipboardData(text: lines.join('\n')));
    setState(() {
      _copied = true;
    });
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) {
        setState(() {
          _copied = false;
        });
      }
    });
  }

  int _displayMinutes(int categoryId, String date) {
    final key = '$categoryId-$date';
    if (_localOverrides.containsKey(key)) {
      return _localOverrides[key]!;
    }

    final day = _firstWhereOrNull(
        _summary?.days ?? const <WeeklyDay>[], (item) => item.date == date);
    final category = _firstWhereOrNull(
      day?.categories ?? const <WeeklyCategorySummary>[],
      (item) => item.categoryId == categoryId,
    );
    return category?.minutes ?? 0;
  }

  void _startEditingCell(int categoryId, String date) {
    final currentlyEditing = _editingCell;
    if (currentlyEditing?.categoryId == categoryId &&
        currentlyEditing?.date == date) {
      return;
    }

    if (currentlyEditing != null) {
      _localOverrides.remove(currentlyEditing.key);
    }

    setState(() {
      _editingCell = _EditingCell(categoryId: categoryId, date: date);
      _actionMessage = null;
    });
  }

  void _updateEditingCell(String value) {
    final editingCell = _editingCell;
    if (editingCell == null) return;

    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      setState(() {
        _localOverrides[editingCell.key] = 0;
      });
      return;
    }

    final hours = double.tryParse(trimmed);
    if (hours == null || hours < 0) return;

    setState(() {
      _localOverrides[editingCell.key] = (hours * 60).round();
    });
  }

  void _cancelEditingCell() {
    final editingCell = _editingCell;
    if (editingCell == null) return;

    setState(() {
      _localOverrides.remove(editingCell.key);
      _editingCell = null;
    });
  }

  Future<void> _saveEditingCell(String value) async {
    final api = context.read<AppStateProvider>().api;
    final editingCell = _editingCell;
    if (api == null || editingCell == null) return;

    final trimmed = value.trim();
    final hours = trimmed.isEmpty ? 0 : double.tryParse(trimmed);
    if (hours == null || hours < 0) {
      _cancelEditingCell();
      return;
    }

    final minutes = (hours * 60).round();
    final key = editingCell.key;

    setState(() {
      _localOverrides[key] = minutes;
      _editingCell = null;
      _actionMessage = null;
    });

    try {
      await api.adjustCell(
        date: editingCell.date,
        categoryId: editingCell.categoryId,
        minutes: minutes,
      );
      await _load();
      if (!mounted) return;
      setState(() {
        _actionMessage = 'Updated ${editingCell.date}.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _localOverrides.remove(key);
        _actionMessage = 'Unable to save cell: $error';
      });
      await _load();
    }
  }

  Future<void> _openDayLog(String date) async {
    final api = context.read<AppStateProvider>().api;
    final categories = context.read<AppStateProvider>().categories;
    if (api == null) return;

    final changed = await showDailyLogDialog(
      context: context,
      date: date,
      api: api,
      categories: categories,
    );

    if (changed) {
      await _load();
      if (!mounted) return;
      setState(() {
        _actionMessage = 'Day log updated for $date.';
      });
    }
  }

  Map<int, int> _computedTotalsByCategory(WeeklySummary summary) {
    final categoryIds = <int>{
      for (final day in summary.days)
        ...day.categories.map((category) => category.categoryId),
    };

    final totals = <int, int>{};
    for (final categoryId in categoryIds) {
      totals[categoryId] = summary.days.fold<int>(
        0,
        (sum, day) => sum + _displayMinutes(categoryId, day.date),
      );
    }
    return totals;
  }

  @override
  Widget build(BuildContext context) {
    final categories = context.watch<AppStateProvider>().categories;
    final monday = _weekStart(_referenceDate);
    final endOfWeek = monday.add(const Duration(days: 6));
    final weekLabel =
        '${DateFormat('d MMM').format(monday)} – ${DateFormat('d MMM').format(endOfWeek)}';
    final isCurrentWeek = _isoWeek(_referenceDate) == _isoWeek(DateTime.now());
    final cs = Theme.of(context).colorScheme;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              MacosIconButton(
                backgroundColor: Colors.transparent,
                hoverColor: cs.surfaceContainerLow,
                icon: const Icon(CupertinoIcons.chevron_left, size: 16),
                onPressed: _prevWeek,
                boxConstraints: const BoxConstraints(
                    minWidth: 28, minHeight: 28, maxWidth: 28, maxHeight: 28),
              ),
              Column(
                children: [
                  Text(
                    weekLabel,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (_summary != null)
                    Text(
                      '${_fmtHours(_summary!.totalMinutes.toDouble())} / ${_fmtHours(_summary!.goalMinutes.toDouble())}',
                      style: TextStyle(
                        fontSize: 11,
                        color: cs.onSurfaceVariant,
                      ),
                    ),
                ],
              ),
              MacosIconButton(
                backgroundColor: Colors.transparent,
                hoverColor: cs.surfaceContainerLow,
                icon: Icon(
                  CupertinoIcons.chevron_right,
                  size: 16,
                  color: isCurrentWeek ? cs.onSurfaceVariant.withValues(alpha: 0.3) : null,
                ),
                onPressed: isCurrentWeek ? null : _nextWeek,
                boxConstraints: const BoxConstraints(
                    minWidth: 28, minHeight: 28, maxWidth: 28, maxHeight: 28),
              ),
            ],
          ),
        ),
        Divider(height: 1, thickness: 0.5, color: cs.outlineVariant),
        if (_loading)
          const Expanded(
              child: Center(child: ProgressCircle(value: null)))
        else if (_error != null)
          Expanded(
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _error!,
                    style: TextStyle(color: cs.error, fontSize: 12),
                  ),
                  const SizedBox(height: 8),
                  PushButton(
                    controlSize: ControlSize.small,
                    secondary: true,
                    onPressed: _load,
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          )
        else if (categories.isEmpty)
          Expanded(
            child: Center(
              child: Text(
                'No categories yet.\nCreate some in the web app.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: cs.onSurfaceVariant,
                  fontSize: 13,
                ),
              ),
            ),
          )
        else if (_summary == null)
          Expanded(
            child: Center(
              child: Text(
                'No entries this week',
                style: TextStyle(
                  color: cs.onSurfaceVariant,
                  fontSize: 13,
                ),
              ),
            ),
          )
        else ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
            child: Text(
              'Click a total cell to adjust that day/category total directly. Click a day header to inspect, edit, delete, or backfill the actual entries for that day.',
              style: TextStyle(
                fontSize: 12,
                color: cs.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: _SummaryTable(
              summary: _summary!,
              categories: categories,
              editingCell: _editingCell,
              displayMinutes: _displayMinutes,
              onCellTap: _startEditingCell,
              onCellChange: _updateEditingCell,
              onCellSave: _saveEditingCell,
              onCellCancel: _cancelEditingCell,
              onDayHeaderTap: _openDayLog,
            ),
          ),
          Divider(height: 1, thickness: 0.5, color: cs.outlineVariant),
          Padding(
            padding: const EdgeInsets.all(10),
            child: Column(
              children: [
                Row(
                  children: [
                    Text(
                      'Total: ${_fmtHours(_computedTotalsByCategory(_summary!).values.fold<int>(0, (sum, value) => sum + value).toDouble())}',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const Spacer(),
                    MouseRegion(
                      cursor: SystemMouseCursors.click,
                      onEnter: (_) => setState(() => _copyHovered = true),
                      onExit: (_) => setState(() => _copyHovered = false),
                      child: GestureDetector(
                        onTap: _copyToClipboard,
                        child: AnimatedOpacity(
                          opacity: _copyHovered ? 0.65 : 1.0,
                          duration: const Duration(milliseconds: 80),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                _copied
                                    ? CupertinoIcons.checkmark
                                    : CupertinoIcons.doc_on_clipboard,
                                size: 14,
                                color: _copied ? Colors.green : cs.onSurfaceVariant,
                              ),
                              const SizedBox(width: 4),
                              Text(
                                _copied ? 'Copied!' : 'Copy',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: _copied ? Colors.green : cs.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                if (_actionMessage != null) ...[
                  const SizedBox(height: 6),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      _actionMessage!,
                      style: TextStyle(
                        fontSize: 11,
                        color: cs.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _SummaryTable extends StatelessWidget {
  final WeeklySummary summary;
  final List<TkCategory> categories;
  final _EditingCell? editingCell;
  final int Function(int categoryId, String date) displayMinutes;
  final void Function(int categoryId, String date) onCellTap;
  final void Function(String value) onCellChange;
  final Future<void> Function(String value) onCellSave;
  final VoidCallback onCellCancel;
  final Future<void> Function(String date) onDayHeaderTap;

  const _SummaryTable({
    required this.summary,
    required this.categories,
    required this.editingCell,
    required this.displayMinutes,
    required this.onCellTap,
    required this.onCellChange,
    required this.onCellSave,
    required this.onCellCancel,
    required this.onDayHeaderTap,
  });

  @override
  Widget build(BuildContext context) {
    final categoryMeta = <int, WeeklyCategorySummary>{};
    for (final day in summary.days) {
      for (final category in day.categories) {
        categoryMeta.putIfAbsent(category.categoryId, () => category);
      }
    }

    final orderedIds = categories
        .where((category) => categoryMeta.containsKey(category.id))
        .map((category) => category.id)
        .toList();

    if (orderedIds.isEmpty) {
      return Center(
        child: Text(
          'No entries this week',
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
            fontSize: 13,
          ),
        ),
      );
    }

    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    final rows = <TableRow>[
      TableRow(
        children: [
          const _Cell('', header: true),
          for (var index = 0; index < summary.days.length; index++)
            _DayHeaderCell(
              label: dayLabels[index],
              date: summary.days[index].date,
              onTap: () => onDayHeaderTap(summary.days[index].date),
            ),
          const _Cell('∑', header: true),
        ],
      ),
    ];

    for (final categoryId in orderedIds) {
      final category = categoryMeta[categoryId]!;
      final rowMinutes = [
        for (final day in summary.days) displayMinutes(categoryId, day.date),
      ];
      final rowTotal = rowMinutes.fold<int>(0, (sum, minutes) => sum + minutes);
      final isRowEditing = editingCell?.categoryId == categoryId;
      if (rowTotal == 0 && !isRowEditing) continue;

      rows.add(
        TableRow(
          children: [
            _CategoryCell(category),
            for (var index = 0; index < summary.days.length; index++)
              _EditableSummaryCell(
                isEditing: editingCell?.categoryId == categoryId &&
                    editingCell?.date == summary.days[index].date,
                displayText: _fmtHoursCompact(rowMinutes[index].toDouble()),
                initialValue: _hoursInputValue(rowMinutes[index]),
                onTap: () => onCellTap(categoryId, summary.days[index].date),
                onChanged: onCellChange,
                onSave: onCellSave,
                onCancel: onCellCancel,
                cellKey: '$categoryId-${summary.days[index].date}',
              ),
            _Cell(_fmtHoursCompact(rowTotal.toDouble()), bold: true),
          ],
        ),
      );
    }

    rows.add(
      TableRow(
        decoration: BoxDecoration(
          border: Border(
            top: BorderSide(
              color: Theme.of(context).colorScheme.outlineVariant,
            ),
          ),
        ),
        children: [
          const _Cell('Total', bold: true),
          for (final day in summary.days)
            _Cell(
              _fmtHoursCompact(
                orderedIds
                    .fold<int>(
                      0,
                      (sum, categoryId) =>
                          sum + displayMinutes(categoryId, day.date),
                    )
                    .toDouble(),
              ),
              bold: true,
            ),
          _Cell(
            _fmtHoursCompact(
              orderedIds
                  .fold<int>(
                    0,
                    (sum, categoryId) =>
                        sum +
                        summary.days.fold<int>(
                            0,
                            (daySum, day) =>
                                daySum + displayMinutes(categoryId, day.date)),
                  )
                  .toDouble(),
            ),
            bold: true,
          ),
        ],
      ),
    );

    return SingleChildScrollView(
      scrollDirection: Axis.vertical,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Table(
          columnWidths: {
            0: const FlexColumnWidth(2.8),
            for (var i = 1; i <= 7; i++) i: const FlexColumnWidth(1.1),
            8: const FlexColumnWidth(1.2),
          },
          children: rows,
        ),
      ),
    );
  }
}

class _DayHeaderCell extends StatelessWidget {
  final String label;
  final String date;
  final VoidCallback onTap;

  const _DayHeaderCell({
    required this.label,
    required this.date,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 4),
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
            child: Column(
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: cs.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  date.substring(5),
                  style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant),
                ),
                const SizedBox(height: 2),
                Text(
                  'Log',
                  style: TextStyle(fontSize: 10, color: cs.primary),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _EditableSummaryCell extends StatelessWidget {
  final bool isEditing;
  final String displayText;
  final String initialValue;
  final VoidCallback onTap;
  final void Function(String value) onChanged;
  final Future<void> Function(String value) onSave;
  final VoidCallback onCancel;
  final String cellKey;

  const _EditableSummaryCell({
    required this.isEditing,
    required this.displayText,
    required this.initialValue,
    required this.onTap,
    required this.onChanged,
    required this.onSave,
    required this.onCancel,
    required this.cellKey,
  });

  @override
  Widget build(BuildContext context) {
    if (isEditing) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 4),
        child: _InlineEditField(
          key: ValueKey(cellKey),
          initialValue: initialValue,
          onChanged: onChanged,
          onSave: onSave,
          onCancel: onCancel,
        ),
      );
    }

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 2),
          child: Text(
            displayText,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12,
              color: Theme.of(context).colorScheme.onSurface,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ),
      ),
    );
  }
}

class _InlineEditField extends StatefulWidget {
  final String initialValue;
  final void Function(String value) onChanged;
  final Future<void> Function(String value) onSave;
  final VoidCallback onCancel;

  const _InlineEditField({
    super.key,
    required this.initialValue,
    required this.onChanged,
    required this.onSave,
    required this.onCancel,
  });

  @override
  State<_InlineEditField> createState() => _InlineEditFieldState();
}

class _InlineEditFieldState extends State<_InlineEditField> {
  late final TextEditingController _controller;
  late final FocusNode _focusNode;
  bool _closing = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialValue);
    _focusNode = FocusNode();
    _focusNode.addListener(() {
      if (!_focusNode.hasFocus && !_closing) {
        _closing = true;
        widget.onSave(_controller.text);
      }
    });

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _focusNode.requestFocus();
      _controller.selection = TextSelection(
        baseOffset: 0,
        extentOffset: _controller.text.length,
      );
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      onKeyEvent: (_, event) {
        if (event is KeyDownEvent &&
            event.logicalKey == LogicalKeyboardKey.escape) {
          _closing = true;
          widget.onCancel();
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      child: MacosTextField(
        controller: _controller,
        focusNode: _focusNode,
        onChanged: widget.onChanged,
        onSubmitted: (value) {
          if (_closing) return;
          _closing = true;
          widget.onSave(value);
        },
        keyboardType:
            const TextInputType.numberWithOptions(decimal: true, signed: false),
        textAlign: TextAlign.center,
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
        style: const TextStyle(fontSize: 12),
      ),
    );
  }
}

class _Cell extends StatelessWidget {
  final String text;
  final bool header;
  final bool bold;

  const _Cell(this.text, {this.header = false, this.bold = false});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 2),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: TextStyle(
          fontSize: 12,
          fontWeight: (header || bold) ? FontWeight.w700 : FontWeight.w500,
          color: header ? cs.onSurfaceVariant : cs.onSurface,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
    );
  }
}

class _CategoryCell extends StatelessWidget {
  final WeeklyCategorySummary category;

  const _CategoryCell(this.category);

  @override
  Widget build(BuildContext context) {
    final color = Color(
      int.parse('FF${category.color.replaceAll('#', '')}', radix: 16),
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: color.withValues(alpha: 0.3),
                  blurRadius: 2,
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  category.name,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (category.workdayCode != null)
                  Text(
                    category.workdayCode!,
                    style: TextStyle(
                      fontSize: 10,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EditingCell {
  final int categoryId;
  final String date;

  const _EditingCell({required this.categoryId, required this.date});

  String get key => '$categoryId-$date';
}

String _fmtHours(double minutes) {
  if (minutes == 0) return '0h';
  final hours = minutes ~/ 60;
  final remainingMinutes = (minutes % 60).round();
  if (remainingMinutes == 0) return '${hours}h';
  return '${hours}h ${remainingMinutes}m';
}

String _fmtHoursCompact(double minutes) {
  if (minutes == 0) return '–';
  return '${(minutes / 60).toStringAsFixed(1)}h';
}

String _hoursInputValue(int minutes) {
  if (minutes == 0) return '';
  if (minutes % 60 == 0) return '${minutes ~/ 60}';
  return (minutes / 60).toStringAsFixed(1);
}

T? _firstWhereOrNull<T>(Iterable<T> items, bool Function(T item) test) {
  for (final item in items) {
    if (test(item)) return item;
  }
  return null;
}
