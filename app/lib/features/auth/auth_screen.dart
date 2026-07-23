import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_colors.dart';
import '../../data/repositories/auth_repository.dart';

/// Écran de connexion / inscription par email + mot de passe (sans email à
/// recevoir).
class AuthScreen extends ConsumerStatefulWidget {
  const AuthScreen({super.key});

  @override
  ConsumerState<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends ConsumerState<AuthScreen> {
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();

  bool _signUpMode = false; // false = connexion, true = création de compte
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    _nameCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final auth = ref.read(authRepositoryProvider);
    try {
      final email = _emailCtrl.text.trim();
      final password = _passwordCtrl.text;
      if (_signUpMode) {
        final res = await auth.signUp(
          email: email,
          password: password,
          displayName: _nameCtrl.text.trim(),
        );
        // Session immédiate = « Confirm email » désactivé → connecté.
        // Pas de session = confirmation exigée côté Supabase → message clair.
        if (res.session == null && auth.currentUser == null) {
          setState(() => _error =
              'Compte créé ✅ mais Supabase demande une confirmation par email.\n'
              'L\'admin doit décocher « Confirm email » (Authentication → '
              'Providers → Email → Save), puis reconnecte-toi.');
          return;
        }
      } else {
        await auth.signIn(email: email, password: password);
      }
      // La redirection est gérée par le router (état d'auth).
    } catch (e) {
      final msg = _friendlyError(e);
      // « Compte déjà existant » en création → bascule vers la connexion.
      if (_signUpMode && msg.contains('existe déjà')) {
        setState(() {
          _signUpMode = false;
          _error = 'Ce compte existe déjà — connecte-toi avec ton mot de passe.';
        });
      } else {
        setState(() => _error = msg);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _friendlyError(Object e) {
    final msg = e.toString();
    if (msg.contains('Invalid login')) {
      return 'Email ou mot de passe incorrect.';
    }
    if (msg.contains('already registered') || msg.contains('User already')) {
      return 'Ce compte existe déjà — connecte-toi.';
    }
    if (msg.contains('Password should be')) {
      return 'Mot de passe trop court (6 caractères minimum).';
    }
    if (msg.contains('Email not confirmed')) {
      return 'Confirmation email requise. (Admin : désactive « Confirm email » dans Supabase.)';
    }
    return msg.replaceAll('AuthException(message: ', '').replaceAll(')', '');
  }

  @override
  Widget build(BuildContext context) {
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
                if (_signUpMode) ...[
                  TextField(
                    controller: _nameCtrl,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(hintText: 'Ton pseudo'),
                  ),
                  const SizedBox(height: 12),
                ],
                TextField(
                  controller: _emailCtrl,
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  decoration: const InputDecoration(hintText: 'ton@email.com'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _passwordCtrl,
                  obscureText: true,
                  decoration: const InputDecoration(hintText: 'Mot de passe'),
                  onSubmitted: (_) => _busy ? null : _submit(),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: AppColors.danger)),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: _busy
                      ? const SizedBox(
                          height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2))
                      : Text(_signUpMode ? 'Créer mon compte' : 'Se connecter'),
                ),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => setState(() {
                            _signUpMode = !_signUpMode;
                            _error = null;
                          }),
                  child: Text(
                    _signUpMode
                        ? 'J\'ai déjà un compte — Se connecter'
                        : 'Nouveau ? Créer un compte',
                    style: const TextStyle(color: AppColors.textSecondary),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
