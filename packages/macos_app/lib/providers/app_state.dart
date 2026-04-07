import 'dart:async';
import 'package:flutter/foundation.dart';
import '../services/api_service.dart';
import '../services/secure_storage.dart';

enum ConnectionState { unconfigured, connecting, connected, error, authError }

/// Central app state provider.
///
/// Manages API connectivity, live timer polling, and category list.
/// The tray icon manager in main.dart observes this notifier to update the
/// icon and title without needing a Flutter widget tree.
class AppStateProvider extends ChangeNotifier {
  final SecureStorageService _storage;

  AppStateProvider(this._storage);

  // ── Credentials & connection ───────────────────────────────────────────────

  ApiService? _api;
  ConnectionState _connection = ConnectionState.unconfigured;
  String _connectionError = '';

  ApiService? get api => _api;
  ConnectionState get connection => _connection;
  String get connectionError => _connectionError;
  bool get isConnected => _connection == ConnectionState.connected;

  // ── Categories ─────────────────────────────────────────────────────────────

  List<Category> _categories = [];
  List<Category> get categories => _categories;

  Category? categoryById(int id) {
    try {
      return _categories.firstWhere((c) => c.id == id);
    } catch (_) {
      return null;
    }
  }

  // ── Timer state ────────────────────────────────────────────────────────────

  TimerStatus _timerStatus = const TimerStatus(active: false);
  DateTime? _lastTimerPoll;
  Timer? _pollTimer;
  Timer? _tickTimer;

  TimerStatus get timerStatus => _timerStatus;

  /// Elapsed seconds since the active timer started (or 0 if none).
  int get elapsedSeconds {
    if (!_timerStatus.active || _timerStatus.entry == null) return 0;
    final start = DateTime.parse(_timerStatus.entry!.startTime).toLocal();
    return DateTime.now().difference(start).inSeconds.clamp(0, 86400);
  }

  String get elapsedHHMM {
    final total = elapsedSeconds;
    final hh = total ~/ 3600;
    final mm = (total % 3600) ~/ 60;
    return '${hh.toString().padLeft(2, '0')}:${mm.toString().padLeft(2, '0')}';
  }

  // ── Initialise ─────────────────────────────────────────────────────────────

  Future<void> initialise() async {
    final url = await _storage.getApiUrl();
    final token = await _storage.getApiToken();

    if (url == null || url.isEmpty || token == null || token.isEmpty) {
      _connection = ConnectionState.unconfigured;
      notifyListeners();
      return;
    }

    _api = ApiService(baseUrl: url, token: token);
    await _connect();
  }

  Future<void> saveAndConnect({
    required String apiUrl,
    required String apiToken,
  }) async {
    await _storage.saveCredentials(apiUrl: apiUrl, apiToken: apiToken);
    _api = ApiService(baseUrl: apiUrl, token: apiToken);
    await _connect();
  }

  Future<void> disconnect() async {
    _pollTimer?.cancel();
    _tickTimer?.cancel();
    _api = null;
    _connection = ConnectionState.unconfigured;
    _categories = [];
    _timerStatus = const TimerStatus(active: false);
    await _storage.clearCredentials();
    notifyListeners();
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  Future<void> _connect() async {
    _connection = ConnectionState.connecting;
    notifyListeners();

    try {
      await Future.wait([
        _refreshCategories(),
        _refreshTimer(),
      ]);
      _connection = ConnectionState.connected;
      _startPolling();
    } on AuthError {
      _connection = ConnectionState.authError;
      _connectionError = 'Invalid or expired token';
    } on NetworkError catch (e) {
      _connection = ConnectionState.error;
      _connectionError = e.message;
    } catch (e) {
      _connection = ConnectionState.error;
      _connectionError = e.toString();
    }

    notifyListeners();
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _tickTimer?.cancel();

    // Poll the API every 5 s (matching the web app's refetchInterval)
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) => _poll());

    // Tick the elapsed display every second when a timer is active
    _tickTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_timerStatus.active) notifyListeners();
    });
  }

  Future<void> _poll() async {
    if (_api == null) return;
    try {
      await _refreshTimer();
      notifyListeners();
    } on AuthError {
      _connection = ConnectionState.authError;
      _pollTimer?.cancel();
      _tickTimer?.cancel();
      notifyListeners();
    } catch (_) {
      // Transient network error — keep polling, don't change state
    }
  }

  Future<void> _refreshTimer() async {
    _timerStatus = await _api!.getTimerStatus();
    _lastTimerPoll = DateTime.now();
  }

  Future<void> _refreshCategories() async {
    _categories = await _api!.listCategories();
  }

  // ── Timer actions (called from UI) ─────────────────────────────────────────

  Future<void> startTimer(int categoryId) async {
    if (_api == null) return;
    await _api!.startTimer(categoryId);
    await _refreshTimer();
    notifyListeners();
  }

  Future<void> stopTimer() async {
    if (_api == null) return;
    await _api!.stopTimer();
    await _refreshTimer();
    notifyListeners();
  }

  Future<void> refreshAll() async {
    if (_api == null) return;
    await Future.wait([_refreshCategories(), _refreshTimer()]);
    notifyListeners();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _tickTimer?.cancel();
    super.dispose();
  }
}
