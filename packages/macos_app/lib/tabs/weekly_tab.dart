import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../providers/app_state.dart';
import '../services/api_service.dart';

/// Returns the ISO week string (YYYY-Www) for the given date.
String _isoWeek(DateTime date) {
  // ISO week: week containing Thursday. Week 1 has the first Thursday.
  final thursday = date.add(Duration(days: 4 - (date.weekday)));
  final yearStart = DateTime(thursday.year, 1, 1);
  final weekNum = ((thursday.difference(yearStart).inDays) / 7).ceil();
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

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final api = context.read<AppStateProvider>().api;
    if (api == null) return;

    setState(() { _loading = true; _error = null; });
    try {
      final week = _isoWeek(_referenceDate);
      _summary = await api.getWeeklySummary(week);
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() { _loading = false; });
    }
  }

  void _prevWeek() {
    setState(() => _referenceDate = _referenceDate.subtract(const Duration(days: 7)));
    _load();
  }

  void _nextWeek() {
    final next = _referenceDate.add(const Duration(days: 7));
    if (next.isAfter(DateTime.now())) return;
    setState(() => _referenceDate = next);
    _load();
  }

  void _copyToClipboard() {
    final summary = _summary;
    final categories = context.read<AppStateProvider>().categories;
    if (summary == null) return;

    final lines = <String>[];
    for (final cat in categories) {
      final total = summary.totalByCategory[cat.id] ?? 0;
      if (total == 0) continue;
      final hours = _fmtHours(total);
      final code = cat.workdayCode != null ? '${cat.workdayCode}\t' : '';
      lines.add('$code${cat.name}\t$hours');
    }
    final text = lines.join('\n');
    Clipboard.setData(ClipboardData(text: text));
    setState(() => _copied = true);
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _copied = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final categories = context.watch<AppStateProvider>().categories;
    final monday = _weekStart(_referenceDate);
    final weekLabel = DateFormat('d MMM').format(monday) +
        ' – ' +
        DateFormat('d MMM').format(monday.add(const Duration(days: 6)));
    final isCurrentWeek = _isoWeek(_referenceDate) == _isoWeek(DateTime.now());

    return Column(
      children: [
        // Week navigation header
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              IconButton(
                onPressed: _prevWeek,
                icon: const Icon(Icons.chevron_left),
                iconSize: 20,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
              ),
              Text(
                weekLabel,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
              ),
              IconButton(
                onPressed: isCurrentWeek ? null : _nextWeek,
                icon: const Icon(Icons.chevron_right),
                iconSize: 20,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
              ),
            ],
          ),
        ),
        const Divider(height: 1),

        if (_loading)
          const Expanded(child: Center(child: CircularProgressIndicator()))
        else if (_error != null)
          Expanded(
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 12)),
                  const SizedBox(height: 8),
                  TextButton(onPressed: _load, child: const Text('Retry')),
                ],
              ),
            ),
          )
        else if (_summary == null || categories.isEmpty)
          const Expanded(child: Center(child: Text('No data', style: TextStyle(color: Colors.black38))))
        else ...[
          Expanded(child: _SummaryTable(summary: _summary!, categories: categories)),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(10),
            child: Row(
              children: [
                Text(
                  'Total: ${_fmtHours(_summary!.grandTotal)}',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: _copyToClipboard,
                  icon: Icon(
                    _copied ? Icons.check : Icons.copy,
                    size: 14,
                    color: _copied ? Colors.green : null,
                  ),
                  label: Text(
                    _copied ? 'Copied!' : 'Copy',
                    style: TextStyle(
                      fontSize: 12,
                      color: _copied ? Colors.green : null,
                    ),
                  ),
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                ),
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

  const _SummaryTable({required this.summary, required this.categories});

  @override
  Widget build(BuildContext context) {
    // Only show categories that have data this week
    final active = categories
        .where((c) => (summary.totalByCategory[c.id] ?? 0) > 0)
        .toList();

    if (active.isEmpty) {
      return const Center(
        child: Text('No entries this week', style: TextStyle(color: Colors.black38, fontSize: 13)),
      );
    }

    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    return SingleChildScrollView(
      scrollDirection: Axis.vertical,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Table(
          columnWidths: {
            0: const FlexColumnWidth(2.5),
            for (var i = 1; i <= 7; i++) i: const FlexColumnWidth(1),
            8: const FlexColumnWidth(1.2),
          },
          children: [
            // Header row
            TableRow(
              children: [
                const _Cell('', header: true),
                for (final day in dayLabels) _Cell(day, header: true),
                const _Cell('∑', header: true),
              ],
            ),
            // TkCategory rows
            for (final cat in active)
              TableRow(
                children: [
                  _CatCell(cat),
                  for (final day in summary.days)
                    _Cell(_fmtHoursCompact(day.minutesByCategory[cat.id] ?? 0)),
                  _Cell(_fmtHoursCompact(summary.totalByCategory[cat.id] ?? 0), bold: true),
                ],
              ),
            // Total row
            TableRow(
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: Colors.black12)),
              ),
              children: [
                const _Cell('Total', bold: true),
                for (final day in summary.days)
                  _Cell(_fmtHoursCompact(day.totalMinutes), bold: true),
                _Cell(_fmtHoursCompact(summary.grandTotal), bold: true),
              ],
            ),
          ],
        ),
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
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: TextStyle(
          fontSize: 11,
          fontWeight: (header || bold) ? FontWeight.w600 : FontWeight.normal,
          color: header ? Colors.black54 : Colors.black87,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
    );
  }
}

class _CatCell extends StatelessWidget {
  final TkCategory cat;
  const _CatCell(this.cat);

  @override
  Widget build(BuildContext context) {
    final color = Color(int.parse('FF${cat.color.replaceAll('#', '')}', radix: 16));
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Container(width: 6, height: 6, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
          const SizedBox(width: 4),
          Expanded(
            child: Text(
              cat.name,
              style: const TextStyle(fontSize: 11),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

String _fmtHours(double minutes) {
  if (minutes == 0) return '0h';
  final h = minutes ~/ 60;
  final m = (minutes % 60).round();
  if (m == 0) return '${h}h';
  return '${h}h ${m}m';
}

String _fmtHoursCompact(double minutes) {
  if (minutes == 0) return '–';
  final h = (minutes / 60);
  return '${h.toStringAsFixed(1)}h';
}
