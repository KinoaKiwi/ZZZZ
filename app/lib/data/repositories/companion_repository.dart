import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/supabase/supabase_providers.dart';
import '../models/companion.dart';
import '../models/geo_point.dart';

/// Le compagnon du joueur : niche + sortie quotidienne (révèle ~100 m).
class CompanionRepository {
  CompanionRepository(this._client);

  final SupabaseClient _client;

  /// Compagnon du joueur pour un groupe (null s'il n'en a pas encore).
  Future<Companion?> current(String groupId) async {
    final userId = _client.auth.currentUser!.id;
    final row = await _client
        .from('companions')
        .select('id, user_id, group_id, species, den_lat, den_lng')
        .eq('user_id', userId)
        .eq('group_id', groupId)
        .maybeSingle();
    return row == null ? null : Companion.fromMap(row);
  }

  /// Adopte un compagnon (ou pose sa niche) à la position donnée.
  Future<Companion> adopt({
    required String groupId,
    required GeoPoint den,
    String species = 'default',
  }) async {
    final data = await _client.rpc('get_or_create_companion', params: {
      'p_group_id': groupId,
      'p_lat': den.lat,
      'p_lng': den.lng,
      'p_species': species,
    });
    final row =
        data is List ? data.first as Map<String, dynamic> : data as Map<String, dynamic>;
    return Companion.fromMap(row);
  }

  /// Vérifie si le compagnon est déjà sorti aujourd'hui.
  Future<bool> hasRunToday(String companionId) async {
    final today = DateTime.now().toUtc().toIso8601String().substring(0, 10);
    final row = await _client
        .from('companion_runs')
        .select('id')
        .eq('companion_id', companionId)
        .eq('run_date', today)
        .maybeSingle();
    return row != null;
  }

  /// Envoie le compagnon explorer (une fois par jour). Révèle une zone commune
  /// au groupe et rapporte un petit bonus de coins (résolu côté serveur).
  Future<void> sendExploring(String groupId) {
    return _client.rpc('companion_daily_run', params: {'p_group_id': groupId});
  }
}

final companionRepositoryProvider = Provider<CompanionRepository>((ref) {
  return CompanionRepository(ref.watch(supabaseClientProvider));
});

/// Compagnon du joueur pour un groupe.
final companionProvider =
    FutureProvider.family<Companion?, String>((ref, groupId) {
  return ref.watch(companionRepositoryProvider).current(groupId);
});
