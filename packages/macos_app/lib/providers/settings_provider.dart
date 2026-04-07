import 'package:flutter/foundation.dart';
import '../services/api_service.dart';

/// Loads and persists the server-side user settings (weekly goal, rounding).
class SettingsProvider extends ChangeNotifier {
  UserSettings? _settings;
  bool _loading = false;
  String? _error;

  UserSettings? get settings => _settings;
  bool get loading => _loading;
  String? get error => _error;

  Future<void> load(ApiService api) async {
    _loading = true;
    _error = null;
    notifyListeners();

    try {
      _settings = await api.getSettings();
    } catch (e) {
      _error = e.toString();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> update(ApiService api, UserSettings s) async {
    try {
      _settings = await api.updateSettings(s);
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    }
  }
}
