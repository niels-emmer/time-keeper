import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Wraps flutter_secure_storage (macOS Keychain) for API credentials.
class SecureStorageService {
  static const _storage = FlutterSecureStorage(
    // useDataProtectionKeychain defaults to true, which requires
    // com.apple.developer.default-data-protection (an Apple Developer cert
    // entitlement). We use the traditional macOS Keychain instead.
    mOptions: MacOsOptions(
      accountName: 'time-keeper',
      useDataProtectionKeyChain: false,
    ),
  );

  static const _keyApiUrl = 'api_url';
  static const _keyApiToken = 'api_token';

  Future<String?> getApiUrl() => _storage.read(key: _keyApiUrl);
  Future<String?> getApiToken() => _storage.read(key: _keyApiToken);

  Future<void> saveCredentials({
    required String apiUrl,
    required String apiToken,
  }) async {
    await _storage.write(key: _keyApiUrl, value: apiUrl.trimRight().replaceAll(RegExp(r'/$'), ''));
    await _storage.write(key: _keyApiToken, value: apiToken.trim());
  }

  Future<void> clearCredentials() async {
    await _storage.delete(key: _keyApiUrl);
    await _storage.delete(key: _keyApiToken);
  }
}
