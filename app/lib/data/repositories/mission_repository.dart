import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/supabase/supabase_providers.dart';
import '../models/mission.dart';

/// Missions journalières + réclamation des récompenses.
class MissionRepository {
  MissionRepository(this._client);

  final SupabaseClient _client;

  /// Missions du jour avec l'avancement du joueur.
  /// Garantit d'abord que le lot du jour existe (idempotent, côté serveur).
  Future<List<Mission>> today() async {
    await _client.rpc('ensure_daily_missions');

    final today = DateTime.now().toUtc().toIso8601String().substring(0, 10);
    final rows = await _client
        .from('daily_missions')
        .select('id, code, title, category, goal, reward, '
            'mission_progress(progress, completed_at, claimed)')
        .eq('for_date', today)
        .order('reward', ascending: false);

    return (rows as List)
        .map((r) => Mission.fromMap(r as Map<String, dynamic>))
        .toList();
  }

  /// Réclame la récompense d'une mission terminée (crédit serveur). Renvoie le
  /// nouveau solde.
  Future<int> claim(String missionId, String groupId) async {
    final balance = await _client.rpc('claim_mission', params: {
      'p_mission_id': missionId,
      'p_group_id': groupId,
    });
    return (balance as num).toInt();
  }
}

final missionRepositoryProvider = Provider<MissionRepository>((ref) {
  return MissionRepository(ref.watch(supabaseClientProvider));
});

/// Missions du jour (rafraîchies après réclamation via invalidate).
final missionsProvider = FutureProvider<List<Mission>>((ref) {
  return ref.watch(missionRepositoryProvider).today();
});
