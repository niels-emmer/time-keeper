import 'dart:async';
import 'package:flutter/material.dart';

/// Full-window splash shown once at startup.
/// Auto-dismisses after [_totalSeconds] seconds; user can also click "Get Started".
class SplashScreen extends StatefulWidget {
  final VoidCallback onDismiss;
  const SplashScreen({super.key, required this.onDismiss});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  static const _totalSeconds = 5;
  int _remaining = _totalSeconds;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) { t.cancel(); return; }
      if (_remaining <= 1) {
        t.cancel();
        widget.onDismiss();
      } else {
        setState(() => _remaining--);
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: cs.surface,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // App icon
              ClipRRect(
                borderRadius: BorderRadius.circular(18),
                child: Image.asset(
                  'assets/images/app_icon.png',
                  width: 80,
                  height: 80,
                  filterQuality: FilterQuality.high,
                ),
              ),
              const SizedBox(height: 16),

              // Title
              Text(
                'Time Keeper',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  color: cs.onSurface,
                ),
              ),
              const SizedBox(height: 6),

              // Subtitle
              Text(
                'Your work timer lives in the menu bar.\n'
                'Click the icon any time to track or review.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13,
                  color: cs.onSurfaceVariant,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 28),

              // Dismiss button with countdown
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: widget.onDismiss,
                  child: Text(
                    _remaining < _totalSeconds
                        ? 'Get Started ($_remaining)'
                        : 'Get Started',
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
