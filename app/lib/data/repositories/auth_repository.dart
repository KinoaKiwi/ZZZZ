import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/supabase/supabase_providers.dart';
import '../models/profile.dart';

/// Accès à l'authentification et au profil du joueur courant.
class AuthRepository {
  AuthRepository(this._client);

  final SupabaseClient _client;

  User? get currentUser => _client.auth.currentUser;

  /// Envoie un code de connexion (OTP) par email — onboarding mobile fluide.
  Future<void> signInWithOtp(String email) {
    return _client.auth.signInWithOtp(
      email: email,
      emailRedirectTo: 'gayeulle://',
    );
  }

  /// Vérifie le code reçu par email et ouvre la session.
  Future<AuthResponse> verifyOtp({required String email, required String token}) {
    return _client.auth.verifyOTP(
      email: email,
      token: token,
      type: OtpType.email,
    );
  }

  Future<void> signOut() => _client.auth.signOut();

  /// Profil de jeu de l'utilisateur courant.
  Future<Profile?> currentProfile() async {
    final id = currentUser?.id;
    if (id == null) return null;
    final data = await _client.from('profiles').select().eq('id', id).maybeSingle();
    return data == null ? null : Profile.fromMap(data);
  }

  /// Met à jour le pseudo et/ou la couleur du joueur.
  Future<Profile> updateProfile({String? displayName, String? color, String? avatarKey}) async {
    final id = currentUser!.id;
    final payload = <String, dynamic>{
      if (displayName != null) 'display_name': displayName,
      if (color != null) 'color': color,
      if (avatarKey != null) 'avatar_key': avatarKey,
    };
    final data = await _client.from('profiles').update(payload).eq('id', id).select().single();
    return Profile.fromMap(data);
  }
}

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(ref.watch(supabaseClientProvider));
});

/// Profil de jeu de l'utilisateur courant (pseudo, couleur, avatar).
final currentProfileProvider = FutureProvider<Profile?>((ref) {
  ref.watch(authStateProvider); // recharge à la connexion/déconnexion
  return ref.watch(authRepositoryProvider).currentProfile();
});
