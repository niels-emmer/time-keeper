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
  final String? notes;
  final bool rounded;

  const TimeEntry({
    required this.id,
    required this.categoryId,
    required this.startTime,
    this.endTime,
    this.notes,
    required this.rounded,
  });

  factory TimeEntry.fromJson(Map<String, dynamic> j) => TimeEntry(
        id: j['id'] as int,
        categoryId: j['categoryId'] as int,
        startTime: j['startTime'] as String,
        endTime: j['endTime'] as String?,
        notes: j['notes'] as String?,
        rounded: j['rounded'] as bool? ?? false,
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

class WeeklyCategorySummary {
  final int categoryId;
  final String name;
  final String color;
  final String? workdayCode;
  final int minutes;
  final double roundedHours;

  const WeeklyCategorySummary({
    required this.categoryId,
    required this.name,
    required this.color,
    required this.workdayCode,
    required this.minutes,
    required this.roundedHours,
  });

  factory WeeklyCategorySummary.fromJson(Map<String, dynamic> j) =>
      WeeklyCategorySummary(
        categoryId: j['categoryId'] as int,
        name: j['name'] as String,
        color: j['color'] as String,
        workdayCode: j['workdayCode'] as String?,
        minutes: j['minutes'] as int,
        roundedHours: (j['roundedHours'] as num).toDouble(),
      );
}

class WeeklyDay {
  final String date; // YYYY-MM-DD
  final int totalMinutes;
  final int goalMinutes;
  final List<WeeklyCategorySummary> categories;

  const WeeklyDay({
    required this.date,
    required this.totalMinutes,
    required this.goalMinutes,
    required this.categories,
  });

  factory WeeklyDay.fromJson(Map<String, dynamic> j) => WeeklyDay(
        date: j['date'] as String,
        totalMinutes: j['totalMinutes'] as int,
        goalMinutes: j['goalMinutes'] as int,
        categories: (j['categories'] as List)
            .map((item) =>
                WeeklyCategorySummary.fromJson(item as Map<String, dynamic>))
            .toList(),
      );
}

class WeeklySummary {
  final String week;
  final int totalMinutes;
  final int goalMinutes;
  final List<WeeklyDay> days;

  const WeeklySummary({
    required this.week,
    required this.totalMinutes,
    required this.goalMinutes,
    required this.days,
  });

  factory WeeklySummary.fromJson(Map<String, dynamic> j) => WeeklySummary(
        week: j['week'] as String,
        totalMinutes: j['totalMinutes'] as int,
        goalMinutes: j['goalMinutes'] as int,
        days: (j['days'] as List)
            .map((item) => WeeklyDay.fromJson(item as Map<String, dynamic>))
            .toList(),
      );
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

class EntryPayload {
  final int categoryId;
  final String startTime;
  final String endTime;
  final String? notes;

  const EntryPayload({
    required this.categoryId,
    required this.startTime,
    required this.endTime,
    this.notes,
  });

  Map<String, dynamic> toJson() => {
        'categoryId': categoryId,
        'startTime': startTime,
        'endTime': endTime,
        'notes': notes,
      };
}

// ── API client ───────────────────────────────────────────────────────────────

class ApiService {
  final String baseUrl; // e.g. https://api.timekeeper.yourdomain.com
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
      final http.Response response;
      switch (method) {
        case 'GET':
          response = await http.get(uri, headers: _headers);
          break;
        case 'POST':
          response = await http.post(
            uri,
            headers: _headers,
            body: json.encode(body ?? {}),
          );
          break;
        case 'PUT':
          response = await http.put(
            uri,
            headers: _headers,
            body: json.encode(body ?? {}),
          );
          break;
        case 'PATCH':
          response = await http.patch(
            uri,
            headers: _headers,
            body: json.encode(body ?? {}),
          );
          break;
        case 'DELETE':
          response = await http.delete(uri, headers: _headers);
          break;
        default:
          throw ArgumentError('Unknown HTTP method: $method');
      }

      if (response.statusCode == 401 || response.statusCode == 403) {
        throw AuthError(response.statusCode);
      }
      if (response.statusCode == 204) return null;
      if (!_isOk(response.statusCode)) {
        final bodyJson = json.decode(response.body) as Map<String, dynamic>;
        throw NetworkError(
          bodyJson['error'] as String? ?? 'HTTP ${response.statusCode}',
        );
      }
      return json.decode(response.body);
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
    return (data as List)
        .map((e) => TkCategory.fromJson(e as Map<String, dynamic>))
        .toList();
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
    return (data as List)
        .map((e) => TimeEntry.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<TimeEntry> createEntry(EntryPayload payload) async {
    final data = await _request('POST', '/entries', body: payload.toJson());
    return TimeEntry.fromJson(data as Map<String, dynamic>);
  }

  Future<TimeEntry> updateEntry(int id, EntryPayload payload) async {
    final data =
        await _request('PATCH', '/entries/$id', body: payload.toJson());
    return TimeEntry.fromJson(data as Map<String, dynamic>);
  }

  Future<void> deleteEntry(int id) async {
    await _request('DELETE', '/entries/$id');
  }

  // ── Weekly summary ─────────────────────────────────────────────────────────

  Future<WeeklySummary> getWeeklySummary(String week) async {
    final data =
        await _request('GET', '/summary/weekly', query: {'week': week});
    return WeeklySummary.fromJson(data as Map<String, dynamic>);
  }

  Future<void> adjustCell({
    required String date,
    required int categoryId,
    required int minutes,
  }) async {
    await _request(
      'PATCH',
      '/summary/adjust-cell',
      body: {
        'date': date,
        'categoryId': categoryId,
        'minutes': minutes,
      },
    );
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
