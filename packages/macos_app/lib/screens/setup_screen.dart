import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_state.dart' as app_state;
import '../services/api_service.dart';

/// Shown when no credentials are stored in Keychain.
/// The user enters their API URL and personal access token here.
class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key});

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  final _urlController = TextEditingController(text: 'https://api.');
  final _tokenController = TextEditingController();
  bool _tokenVisible = false;
  bool _testing = false;
  String? _testError;

  @override
  void dispose() {
    _urlController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  /// Reject any base URL that would put the access token on the wire in clear
  /// text (finding L-9).
  ///
  /// [ApiService] sends the token as an `Authorization: Bearer` header on every
  /// request, so a plain `http://` URL leaks it to anything that can observe the
  /// connection. `https://` is therefore required unless the host is loopback,
  /// which is the only case where the traffic never leaves the machine (a
  /// developer running the stack locally).
  ///
  /// Returns an error message, or `null` when the URL is acceptable.
  static String? _validateUrl(String value) {
    final uri = Uri.tryParse(value);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      return 'Enter a full URL including https:// — for example https://api.example.com';
    }

    if (uri.scheme == 'https') return null;
    if (uri.scheme == 'http' && _isLoopbackHost(uri.host)) return null;

    return 'Use https:// instead of ${uri.scheme}://. '
        'Your access token is sent with every request, so over an insecure '
        'connection it can be read and reused by anyone on the network. '
        'http:// is allowed only for localhost / 127.0.0.1.';
  }

  /// True for the hosts a local development stack runs on: `localhost`, the
  /// IPv4 loopback block (127.0.0.0/8), and IPv6 `::1`.
  static bool _isLoopbackHost(String host) {
    final normalized = host.toLowerCase();
    if (normalized == 'localhost' || normalized == '::1' || normalized == '[::1]') {
      return true;
    }
    // Dart keeps the brackets on IPv6 literals; strip them before testing.
    final unbracketed = normalized.startsWith('[') && normalized.endsWith(']')
        ? normalized.substring(1, normalized.length - 1)
        : normalized;
    if (unbracketed == '::1') return true;

    final octets = unbracketed.split('.');
    if (octets.length != 4) return false;
    final first = int.tryParse(octets[0]);
    return first == 127 && octets.every((o) => int.tryParse(o) != null);
  }

  Future<void> _connect() async {
    final url = _urlController.text.trim();
    final token = _tokenController.text.trim();

    if (url.isEmpty || token.isEmpty) return;

    final urlError = _validateUrl(url);
    if (urlError != null) {
      setState(() { _testError = urlError; });
      return;
    }

    setState(() { _testing = true; _testError = null; });

    try {
      final testApi = ApiService(baseUrl: url, token: token);
      final ok = await testApi.checkHealth();
      if (!ok) throw const NetworkError('Health check failed — check the URL');

      if (!mounted) return;
      await context.read<app_state.AppStateProvider>().saveAndConnect(
            apiUrl: url,
            apiToken: token,
          );
    } on AuthError {
      setState(() { _testError = 'Invalid token — create one in the web app Settings → Personal Access Tokens'; });
    } on NetworkError catch (e) {
      setState(() { _testError = e.message; });
    } catch (e) {
      setState(() { _testError = e.toString(); });
    } finally {
      if (mounted) setState(() { _testing = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;
    final fieldBg = isDark ? const Color(0xFF2C2C2E) : const Color(0xFFF2F2F7);
    final borderColor = isDark ? const Color(0x1AFFFFFF) : const Color(0x1A000000);

    return Material(
      color: cs.surface,
      child: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 340),
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // App icon
              Center(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.asset(
                    'assets/images/app_icon.png',
                    width: 56,
                    height: 56,
                    filterQuality: FilterQuality.high,
                  ),
                ),
              ),
              const SizedBox(height: 16),

              Center(
                child: Text(
                  'Connect to Time Keeper',
                  style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                      color: cs.onSurface),
                ),
              ),
              const SizedBox(height: 6),
              Center(
                child: Text(
                  'Enter your API URL and a personal access token.\n'
                  'Create one in the web app under Settings → Personal Access Tokens.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      fontSize: 13, color: cs.onSurfaceVariant, height: 1.45),
                ),
              ),
              const SizedBox(height: 20),

              // API URL
              Text('API URL',
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: cs.onSurface)),
              const SizedBox(height: 4),
              CupertinoTextField(
                controller: _urlController,
                placeholder: 'https://api.timekeeper.yourdomain.com',
                autocorrect: false,
                keyboardType: TextInputType.url,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
                decoration: BoxDecoration(
                  color: fieldBg,
                  borderRadius: BorderRadius.circular(7),
                  border: Border.all(color: borderColor, width: 0.5),
                ),
                style: TextStyle(fontSize: 13, color: cs.onSurface),
                placeholderStyle: TextStyle(
                    fontSize: 13, color: cs.onSurfaceVariant),
              ),
              const SizedBox(height: 14),

              // Token
              Text('Access token',
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: cs.onSurface)),
              const SizedBox(height: 4),
              CupertinoTextField(
                controller: _tokenController,
                placeholder: 'Paste your token here',
                obscureText: !_tokenVisible,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
                decoration: BoxDecoration(
                  color: fieldBg,
                  borderRadius: BorderRadius.circular(7),
                  border: Border.all(color: borderColor, width: 0.5),
                ),
                suffix: Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: GestureDetector(
                    onTap: () => setState(() => _tokenVisible = !_tokenVisible),
                    child: Icon(
                      _tokenVisible
                          ? CupertinoIcons.eye_slash
                          : CupertinoIcons.eye,
                      size: 16,
                      color: cs.onSurfaceVariant,
                    ),
                  ),
                ),
                style: TextStyle(
                    fontSize: 13, fontFamily: 'Menlo', color: cs.onSurface),
                placeholderStyle: TextStyle(
                    fontSize: 13, color: cs.onSurfaceVariant),
              ),

              if (_testError != null) ...[
                const SizedBox(height: 10),
                Text(
                  _testError!,
                  style: TextStyle(fontSize: 12, color: cs.error),
                ),
              ],

              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: CupertinoButton.filled(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  onPressed: _testing ? null : _connect,
                  child: _testing
                      ? const CupertinoActivityIndicator(color: Colors.white)
                      : const Text('Connect',
                          style: TextStyle(fontSize: 15)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
