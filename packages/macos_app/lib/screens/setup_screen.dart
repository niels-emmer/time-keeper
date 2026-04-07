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

  Future<void> _connect() async {
    final url = _urlController.text.trim();
    final token = _tokenController.text.trim();

    if (url.isEmpty || token.isEmpty) return;

    setState(() { _testing = true; _testError = null; });

    try {
      // Quick connectivity test before saving
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
    return Scaffold(
      backgroundColor: cs.surface,
      body: Center(
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

              const Center(
                child: Text(
                  'Connect to Time Keeper',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
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
              TextField(
                controller: _urlController,
                decoration: InputDecoration(
                  hintText: 'https://api.timekeeper.yourdomain.com',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide(color: cs.outlineVariant),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide(color: cs.outlineVariant),
                  ),
                  filled: true,
                  fillColor: cs.surfaceContainerLow,
                  isDense: true,
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                ),
                autocorrect: false,
                keyboardType: TextInputType.url,
                style: const TextStyle(fontSize: 13),
              ),
              const SizedBox(height: 14),

              // Token
              Text('Access token',
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: cs.onSurface)),
              const SizedBox(height: 4),
              TextField(
                controller: _tokenController,
                obscureText: !_tokenVisible,
                decoration: InputDecoration(
                  hintText: 'Paste your token here',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide(color: cs.outlineVariant),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide(color: cs.outlineVariant),
                  ),
                  filled: true,
                  fillColor: cs.surfaceContainerLow,
                  isDense: true,
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                  suffixIcon: IconButton(
                    icon: Icon(
                        _tokenVisible
                            ? Icons.visibility_off
                            : Icons.visibility,
                        size: 18),
                    onPressed: () =>
                        setState(() => _tokenVisible = !_tokenVisible),
                  ),
                ),
                style: const TextStyle(fontSize: 13, fontFamily: 'monospace'),
              ),

              if (_testError != null) ...[
                const SizedBox(height: 10),
                Text(
                  _testError!,
                  style: const TextStyle(fontSize: 12, color: Colors.red),
                ),
              ],

              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _testing ? null : _connect,
                  child: _testing
                      ? const SizedBox(
                          height: 16,
                          width: 16,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white),
                        )
                      : const Text('Connect'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
