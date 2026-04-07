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
    return Scaffold(
      body: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 340),
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Connect to Time Keeper',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 4),
              const Text(
                'Enter your API URL and a personal access token.\n'
                'Create one in the web app under Settings → Personal Access Tokens.',
                style: TextStyle(fontSize: 13, color: Colors.black54),
              ),
              const SizedBox(height: 20),

              // API URL
              const Text('API URL', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
              const SizedBox(height: 4),
              TextField(
                controller: _urlController,
                decoration: const InputDecoration(
                  hintText: 'https://api.timekeeper.yourdomain.com',
                  border: OutlineInputBorder(),
                  isDense: true,
                  contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                ),
                autocorrect: false,
                keyboardType: TextInputType.url,
                style: const TextStyle(fontSize: 13),
              ),
              const SizedBox(height: 14),

              // Token
              const Text('Access token', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
              const SizedBox(height: 4),
              TextField(
                controller: _tokenController,
                obscureText: !_tokenVisible,
                decoration: InputDecoration(
                  hintText: 'Paste your token here',
                  border: const OutlineInputBorder(),
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                  suffixIcon: IconButton(
                    icon: Icon(_tokenVisible ? Icons.visibility_off : Icons.visibility, size: 18),
                    onPressed: () => setState(() => _tokenVisible = !_tokenVisible),
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
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
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
