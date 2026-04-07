import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';

/// Generates tray icon PNG files on disk for the colored (active timer) state.
///
/// macOS tray icons must be files on disk; tray_manager accepts an asset path
/// for static icons and a file path for dynamic ones.
///
/// The generated icons are written to the system temp directory and reused
/// (keyed by color hex) to avoid re-creating them on every tick.
class IconGenerator {
  static final Map<String, String> _cache = {};

  /// Returns a file path to a 32×32 PNG filled circle in [hexColor].
  /// The file is created once per color and cached for the session.
  static Future<String> coloredDot(String hexColor) async {
    if (_cache.containsKey(hexColor)) return _cache[hexColor]!;

    final color = _hexToColor(hexColor);
    const size = 32.0;

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, Rect.fromLTWH(0, 0, size, size));

    // Draw a filled circle with a subtle dark border for legibility on light menubar
    final paint = Paint()..color = color..style = PaintingStyle.fill;
    canvas.drawCircle(const Offset(size / 2, size / 2), size / 2 - 2, paint);
    // border
    final border = Paint()
      ..color = color.withOpacity(0.6)..style = PaintingStyle.stroke..strokeWidth = 1.5;
    canvas.drawCircle(const Offset(size / 2, size / 2), size / 2 - 2.75, border);

    final picture = recorder.endRecording();
    final img = await picture.toImage(size.toInt(), size.toInt());
    final byteData = await img.toByteData(format: ui.ImageByteFormat.png);
    final bytes = byteData!.buffer.asUint8List();

    final tempDir = Directory.systemTemp;
    final file = File('${tempDir.path}/tk_tray_${hexColor.replaceAll('#', '')}.png');
    await file.writeAsBytes(bytes);

    _cache[hexColor] = file.path;
    return file.path;
  }

  static Color _hexToColor(String hex) {
    final h = hex.replaceAll('#', '');
    final value = int.parse(h.length == 6 ? 'FF$h' : h, radix: 16);
    return Color(value);
  }
}
