import 'dart:convert';
import 'package:http/http.dart' as http;

/// Thrown when the API returns 401 or 403 (expired or invalid token).
class AuthError implements Exception {
  final int status;
  const AuthError(this.status);
  @override
  String toString() => 'AuthError(HTTP $status)';
}

/// Thrown when a network request fails outright (no connectivity, DNS failure, etc.).
class NetworkError implements Exception {
  final String message;
  const NetworkError(this.message);
  @override
  String toString() => 'NetworkError: $message';
}

// ── Data models ──────────────────────────────────────────────────────────────

class TkCategory {
  final int id;
  final String name;
  final String color; // hex e.g. '#6366f1'
  final String? workdayCode;
  final int sortOrder;

  const TkCategory({
    required this.id,
    required this.name,
    required this.color,
    this.workdayCode,
    required this.sortOrder,
  });

  factory TkCategory.fromJson(Map<String, dynamic> j) => TkCategory(
        id: j['id'] as int,
        name: j['name'] as String,
        color: j['color'] as String,
        workdayCode: j['workdayCode'] as String?,
        sortOrder: j['sortOrder'] as int,
      );
}

class TimeEntry {
  final int id;
  final int categoryId;
  final String startTime; // UTC ISO 8601
  final String? endTime;

  const TimeEntry({
    required this.id,
    required this.categoryId,
    required this.startTime,
    this.endTime,
  });

  factory TimeEntry.fromJson(Map<String, dynamic> j) => TimeEntry(
        id: j['id'] as int,
        categoryId: j['categoryId'] as int,
        startTime: j['startTime'] as String,
        endTime: j['endTime'] as String?,
      );
}

class TimerStatus {
  final bool active;
  final TimeEntry? entry;

  const TimerStatus({required this.active, this.entry});

  factory TimerStatus.fromJson(Map<String, dynamic> j) => TimerStatus(
        active: j['active'] as bool,
        entry: j['active'] == true && j['entry'] != null
            ? TimeEntry.fromJson(j['entry'] as Map<String, dynamic>)
            : null,
      );
}

class WeeklyDay {
  final String date;       // YYYY-MM-DD
  final String dayName;    // "Mon", "Tue", …
  final Map<int, double> minutesByCategory; // categoryId → minutes
  final double totalMinutes;

  const WeeklyDay({
    required this.date,
    required this.dayName,
    required this.minutesByCategory,
    required this.totalMinutes,
  });
}

class WeeklySummary {
  final String week;
  final List<WeeklyDay> days;
  final Map<int, double> totalByCategory;
  final double grandTotal;

  const WeeklySummary({
    required this.week,
    required this.days,
    required this.totalByCategory,
    required this.grandTotal,
  });

  factory WeeklySummary.fromJson(Map<String, dynamic> j) {
    final days = (j['days'] as List)
        .map((d) => _dayFromJson(d as Map<String, dynamic>))
        .toList();

    final Map<int, double> totals = {};
    for (final day in days) {
      day.minutesByCategory.forEach((catId, mins) {
        totals[catId] = (totals[catId] ?? 0) + mins;
      });
    }
    final grandTotal = totals.values.fold(0.0, (a, b) => a + b);

    return WeeklySummary(
      week: j['week'] as String,
      days: days,
      totalByCategory: totals,
      grandTotal: grandTotal,
    );
  }

  static WeeklyDay _dayFromJson(Map<String, dynamic> j) {
    final date = j['date'] as String;
    final entriesByCategory = j['entriesByCategory'] as Map<String, dynamic>? ?? {};
    final Map<int, double> minutesByCategory = {};

    entriesByCategory.forEach((catIdStr, entries) {
      final catId = int.parse(catIdStr);
      double total = 0;
      for (final e in (entries as List)) {
        total += (e['durationMinutes'] as num).toDouble();
      }
      if (total > 0) minutesByCategory[catId] = total;
    });

    final totalMinutes = minutesByCategory.values.fold(0.0, (a, b) => a + b);

    // derive a short day name from the date
    final dt = DateTime.parse(date);
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    final dayName = dayNames[dt.weekday - 1];

    return WeeklyDay(
      date: date,
      dayName: dayName,
      minutesByCategory: minutesByCategory,
      totalMinutes: totalMinutes,
    );
  }
}

class AppInfo {
  final String version;
  final String user;

  const AppInfo({required this.version, required this.user});

  factory AppInfo.fromJson(Map<String, dynamic> j) => AppInfo(
        version: j['version'] as String,
        user: j['user'] as String,
      );
}

class UserSettings {
  final int weeklyGoalHours;
  final int roundingIncrementMinutes;

  const UserSettings({
    required this.weeklyGoalHours,
    required this.roundingIncrementMinutes,
  });

  factory UserSettings.fromJson(Map<String, dynamic> j) => UserSettings(
        weeklyGoalHours: j['weeklyGoalHours'] as int,
        roundingIncrementMinutes: j['roundingIncrementMinutes'] as int,
      );
}

// ── API client ───────────────────────────────────────────────────────────────

class ApiService {
  final String baseUrl;   // e.g. https://api.timekeeper.yourdomain.com
  final String token;

  ApiService({required this.baseUrl, required this.token});

  Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer $token',
  };

  Future<dynamic> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? query,
  }) async {
    var uri = Uri.parse('$baseUrl/api$path');
    if (query != null) uri = uri.replace(queryParameters: query);

    try {
      final http.Response res;
      switch (method) {
        case 'GET':
          res = await http.get(uri, headers: _headers);
        case 'POST':
          res = await http.post(uri, headers: _headers, body: json.encode(body ?? {}));
        case 'PUT':
          res = await http.put(uri, headers: _headers, body: json.encode(body ?? {}));
        case 'PATCH':
          res = await http.patch(uri, headers: _headers, body: json.encode(body ?? {}));
        case 'DELETE':
          res = await http.delete(uri, headers: _headers);
        default:
          throw ArgumentError('Unknown HTTP method: $method');
      }

      if (res.statusCode == 401 || res.statusCode == 403) {
        throw AuthError(res.statusCode);
      }
      if (res.statusCode == 204) return null;
      if (!_isOk(res.statusCode)) {
        final b = json.decode(res.body) as Map<String, dynamic>;
        throw NetworkError(b['error'] as String? ?? 'HTTP ${res.statusCode}');
      }
      return json.decode(res.body);
    } on AuthError {
      rethrow;
    } on NetworkError {
      rethrow;
    } catch (e) {
      throw NetworkError(e.toString());
    }
  }

  bool _isOk(int status) => status >= 200 && status < 300;

  // ── Health / info ──────────────────────────────────────────────────────────

  Future<bool> checkHealth() async {
    try {
      final data = await _request('GET', '/health');
      return (data as Map<String, dynamic>)['status'] == 'ok';
    } catch (_) {
      return false;
    }
  }

  Future<AppInfo> getInfo() async {
    final data = await _request('GET', '/info');
    return AppInfo.fromJson(data as Map<String, dynamic>);
  }

  // ── Categories ─────────────────────────────────────────────────────────────

  Future<List<TkCategory>> listCategories() async {
    final data = await _request('GET', '/categories');
    return (data as List).map((e) => TkCategory.fromJson(e as Map<String, dynamic>)).toList();
  }

  // ── Timer ──────────────────────────────────────────────────────────────────

  Future<TimerStatus> getTimerStatus() async {
    final data = await _request('GET', '/timer');
    return TimerStatus.fromJson(data as Map<String, dynamic>);
  }

  Future<void> startTimer(int categoryId) async {
    await _request('POST', '/timer/start', body: {'categoryId': categoryId});
  }

  Future<void> stopTimer() async {
    await _request('POST', '/timer/stop');
  }

  // ── Entries ────────────────────────────────────────────────────────────────

  Future<List<TimeEntry>> listEntriesByDate(String date) async {
    final data = await _request('GET', '/entries', query: {'date': date});
    return (data as List).map((e) => TimeEntry.fromJson(e as Map<String, dynamic>)).toList();
  }

  // ── Weekly summary ─────────────────────────────────────────────────────────

  Future<WeeklySummary> getWeeklySummary(String week) async {
    final data = await _request('GET', '/summary/weekly', query: {'week': week});
    return WeeklySummary.fromJson(data as Map<String, dynamic>);
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  Future<UserSettings> getSettings() async {
    final data = await _request('GET', '/settings');
    return UserSettings.fromJson(data as Map<String, dynamic>);
  }

  Future<UserSettings> updateSettings(UserSettings s) async {
    final data = await _request('PUT', '/settings', body: {
      'weeklyGoalHours': s.weeklyGoalHours,
      'roundingIncrementMinutes': s.roundingIncrementMinutes,
    });
    return UserSettings.fromJson(data as Map<String, dynamic>);
  }
}
