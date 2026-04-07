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
          const Divider(height: 1),
        ],

        // Category grid
        Expanded(
          child: categories.isEmpty
              ? const Center(
                  child: Text(
                    'No categories yet.\nCreate some in the web app.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.black54, fontSize: 13),
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
                    return _CategoryCard(
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
    final color = cat != null ? _hexColor(cat.color) : Colors.grey;
    final elapsed = state.elapsedHHMM;

    return Container(
      color: color.withOpacity(0.08),
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
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                ),
                Text(
                  cat?.workdayCode != null ? '${cat!.workdayCode} · $elapsed' : elapsed,
                  style: TextStyle(fontSize: 12, color: color, fontFeatures: const [FontFeature.tabularFigures()]),
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
              textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
            ),
            child: const Text('Stop'),
          ),
        ],
      ),
    );
  }
}

class _CategoryCard extends StatelessWidget {
  final Category category;
  final bool isActive;
  final VoidCallback onTap;

  const _CategoryCard({
    required this.category,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = _hexColor(category.color);

    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        decoration: BoxDecoration(
          color: isActive ? color.withOpacity(0.15) : Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isActive ? color : Colors.grey.shade200,
            width: isActive ? 1.5 : 1,
          ),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    category.name,
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (category.workdayCode != null)
                    Text(
                      category.workdayCode!,
                      style: TextStyle(fontSize: 10, color: Colors.grey.shade500),
                    ),
                ],
              ),
            ),
            if (isActive)
              Icon(Icons.stop_circle_outlined, color: color, size: 16),
          ],
        ),
      ),
    );
  }
}

Color _hexColor(String hex) {
  final h = hex.replaceAll('#', '');
  return Color(int.parse('FF$h', radix: 16));
}
