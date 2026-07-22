import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_colors.dart';
import '../../data/repositories/auth_repository.dart';

/// Écran de connexion par code email (OTP). Onboarding mobile fluide.
class AuthScreen extends ConsumerStatefulWidget {
  const AuthScreen({super.key});

  @override
  ConsumerState<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends ConsumerState<AuthScreen> {
  final _emailCtrl = TextEditingController();
  final _tokenCtrl = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _tokenCtrl.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.read(authRepositoryProvider);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('🗺️', style: TextStyle(fontSize: 64)),
                const SizedBox(height: 12),
                Text(
                  'Gayeulle Party',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                        color: AppColors.neonCyan,
                      ),
                ),
                const SizedBox(height: 4),
                const Text(
                  'Votre ville devient votre monde de jeu.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.textSecondary),
                ),
                const SizedBox(height: 32),
                TextField(
                  controller: _emailCtrl,
                  enabled: !_codeSent,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(hintText: 'ton@email.com'),
                ),
                if (_codeSent) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _tokenCtrl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(hintText: 'Code reçu par email'),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: AppColors.danger)),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy
                      ? null
                      : () {
                          if (!_codeSent) {
                            _run(() async {
                              await auth.signInWithOtp(_emailCtrl.text.trim());
                              if (mounted) setState(() => _codeSent = true);
                            });
                          } else {
                            _run(() => auth.verifyOtp(
                                  email: _emailCtrl.text.trim(),
                                  token: _tokenCtrl.text.trim(),
                                ));
                          }
                        },
                  child: _busy
                      ? const SizedBox(
                          height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2))
                      : Text(_codeSent ? 'Se connecter' : 'Recevoir mon code'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
