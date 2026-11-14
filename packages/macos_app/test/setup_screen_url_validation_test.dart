import 'package:flutter_test/flutter_test.dart';
import 'package:time_keeper_macos/screens/setup_screen.dart';

/// Guards finding L-9: the macOS app must not accept a base URL that would send
/// the personal access token in cleartext.
///
/// `ApiService` puts the token in an `Authorization: Bearer` header on every
/// request, so `https://` is required unless the host is loopback.
void main() {
  group('validateApiBaseUrl accepts https', () {
    test('plain https host', () {
      expect(validateApiBaseUrl('https://api.example.com'), isNull);
    });

    test('https with port and path', () {
      expect(validateApiBaseUrl('https://api.example.com:8443/base/'), isNull);
    });

    test('https on loopback is fine too', () {
      expect(validateApiBaseUrl('https://localhost:3001'), isNull);
    });
  });

  group('validateApiBaseUrl allows http only on loopback', () {
    test('localhost', () {
      expect(validateApiBaseUrl('http://localhost:3001'), isNull);
    });

    test('127.0.0.1', () {
      expect(validateApiBaseUrl('http://127.0.0.1:3001'), isNull);
    });

    test('the whole 127/8 block', () {
      expect(validateApiBaseUrl('http://127.5.9.3:3001'), isNull);
    });

    test('IPv6 ::1', () {
      expect(validateApiBaseUrl('http://[::1]:3001'), isNull);
    });
  });

  group('validateApiBaseUrl rejects insecure or malformed URLs', () {
    test('http to a public host', () {
      final error = validateApiBaseUrl('http://example.com');
      expect(error, isNotNull);
      // The copy must explain why, not just say "invalid".
      expect(error, contains('https://'));
      expect(error, contains('token'));
    });

    test('http to a LAN address is not loopback', () {
      expect(validateApiBaseUrl('http://192.168.1.10:3001'), isNotNull);
    });

    test('a 127-prefixed name that is not an IPv4 literal', () {
      // Guards against a naive startsWith('127.') check.
      expect(validateApiBaseUrl('http://127.example.com'), isNotNull);
    });

    test('a non-http scheme', () {
      expect(validateApiBaseUrl('ftp://example.com'), isNotNull);
    });

    test('a schemeless host', () {
      final error = validateApiBaseUrl('api.example.com');
      expect(error, isNotNull);
      expect(error, contains('https://'));
    });

    test('a scheme with no host', () {
      expect(validateApiBaseUrl('https://'), isNotNull);
    });

    test('an empty string', () {
      expect(validateApiBaseUrl(''), isNotNull);
    });
  });
}
