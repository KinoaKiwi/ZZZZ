import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/supabase/supabase_providers.dart';

/// Portefeuille de Djadja Coins et avancement des activités.
///
/// Les crédits/débits sont toujours faits côté serveur (missions, boutique,
/// compagnon) ; ici on lit le solde et on signale les activités du joueur.
class EconomyRepository {
  EconomyRepository(this._client);

  final SupabaseClient _client;

  /// Solde de Djadja Coins du joueur dans un groupe (0 si aucun portefeuille).
  Future<int> balance(String groupId) async {
    final userId = _client.auth.currentUser?.id;
    if (userId == null) return 0;
    final row = await _client
        .from('wallets')
        .select('balance')
        .eq('user_id', userId)
        .eq('group_id', groupId)
        .maybeSingle();
    return (row?['balance'] as num?)?.toInt() ?? 0;
  }

  /// Flux temps réel du solde (se met à jour après missions/achats/compagnon).
  Stream<int> watchBalance(String groupId) {
    final userId = _client.auth.currentUser!.id;
    return _client
        .from('wallets')
        .stream(primaryKey: ['user_id', 'group_id'])
        .eq('group_id', groupId)
        .map((rows) {
          for (final r in rows) {
            if (r['user_id'] == userId) return (r['balance'] as num).toInt();
          }
          return 0;
        });
  }

  /// Signale une activité au serveur pour faire avancer les missions du jour.
  /// [category] : 'walk' (mètres), 'explore' | 'photo' | 'companion' (unités).
  Future<void> recordActivity(String category, int amount) {
    if (amount <= 0) return Future.value();
    return _client.rpc('record_activity', params: {
      'p_category': category,
      'p_amount': amount,
    });
  }
}

final economyRepositoryProvider = Provider<EconomyRepository>((ref) {
  return EconomyRepository(ref.watch(supabaseClientProvider));
});

/// Solde de Djadja Coins (temps réel) pour un groupe.
final walletBalanceProvider = StreamProvider.family<int, String>((ref, groupId) {
  return ref.watch(economyRepositoryProvider).watchBalance(groupId);
});
