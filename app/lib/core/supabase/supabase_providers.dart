import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Client Supabase global (initialisé dans main.dart via Supabase.initialize).
final supabaseClientProvider = Provider<SupabaseClient>((ref) {
  return Supabase.instance.client;
});

/// Flux de l'état d'authentification (connexion / déconnexion).
final authStateProvider = StreamProvider<AuthState>((ref) {
  return ref.watch(supabaseClientProvider).auth.onAuthStateChange;
});

/// Utilisateur courant (null si déconnecté).
final currentUserProvider = Provider<User?>((ref) {
  // Re-calculé à chaque changement d'état d'auth.
  ref.watch(authStateProvider);
  return ref.watch(supabaseClientProvider).auth.currentUser;
});
