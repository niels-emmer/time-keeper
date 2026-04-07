import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_state.dart';
import '../services/api_service.dart';

class TrackTab extends StatelessWidget {
  const TrackTab({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppStateProvider>();
    final categories = state.categories;
    final timer = state.timerStatus;

    return Column(
      children: [
        // Active timer card
        if (timer.active && timer.entry != null) ...[
          _ActiveTimerCard(entry: timer.entry!, state: state),
          Divider(
            height: 1,
            thickness: 0.5,
            color: Theme.of(context).colorScheme.outlineVariant,
          ),
        ],

        // Category grid
        Expanded(
          child: categories.isEmpty
              ? Center(
                  child: Text(
                    'No categories yet.\nCreate some in the web app.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                        fontSize: 13),
                  ),
                )
              : GridView.builder(
                  padding: const EdgeInsets.all(12),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    childAspectRatio: 2.2,
                    mainAxisSpacing: 8,
                    crossAxisSpacing: 8,
                  ),
                  itemCount: categories.length,
                  itemBuilder: (context, i) {
                    final cat = categories[i];
                    final isActive =
                        timer.active && timer.entry?.categoryId == cat.id;
                    return _TkCategoryCard(
                      category: cat,
                      isActive: isActive,
                      onTap: () => isActive
                          ? state.stopTimer()
                          : state.startTimer(cat.id),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

class _ActiveTimerCard extends StatelessWidget {
  final TimeEntry entry;
  final AppStateProvider state;

  const _ActiveTimerCard({required this.entry, required this.state});

  @override
  Widget build(BuildContext context) {
    final cat = state.categoryById(entry.categoryId);
    final color = cat != null ? _hexColor(cat.color) : const Color(0xFF6366F1);
    final elapsed = state.elapsedHHMM;

    return Container(
      color: color.withValues(alpha: 0.06),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  cat?.name ?? 'Unknown',
                  style: const TextStyle(
                      fontWeight: FontWeight.w600, fontSize: 13),
                ),
                Text(
                  cat?.workdayCode != null
                      ? '${cat!.workdayCode} · $elapsed'
                      : elapsed,
                  style: TextStyle(
                    fontSize: 12,
                    color: color,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: state.stopTimer,
            style: TextButton.styleFrom(
              foregroundColor: Colors.red,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              textStyle:
                  const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
            ),
            child: const Text('Stop'),
          ),
        ],
      ),
    );
  }
}

class _TkCategoryCard extends StatelessWidget {
  final TkCategory category;
  final bool isActive;
  final VoidCallback onTap;

  const _TkCategoryCard({
    required this.category,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = _hexColor(category.color);
    final cs = Theme.of(context).colorScheme;

    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        decoration: BoxDecoration(
          color: isActive
              ? color.withValues(alpha: 0.12)
              : cs.surfaceContainerLow,
          borderRadius: BorderRadius.circular(8),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Row(
            children: [
              // Left color bar
              Container(
                width: 3,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: isActive ? 1.0 : 0.5),
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(8),
                    bottomLeft: Radius.circular(8),
                  ),
                ),
              ),
              // Card content
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              category.name,
                              style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w500,
                                  color: cs.onSurface),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            if (category.workdayCode != null)
                              Text(
                                category.workdayCode!,
                                style: TextStyle(
                                    fontSize: 10,
                                    color: cs.onSurface
                                        .withValues(alpha: 0.5)),
                              ),
                          ],
                        ),
                      ),
                      if (isActive)
                        Icon(Icons.stop_circle_outlined,
                            color: color, size: 16),
                    ],
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

Color _hexColor(String hex) {
  final h = hex.replaceAll('#', '');
  return Color(int.parse('FF$h', radix: 16));
}
