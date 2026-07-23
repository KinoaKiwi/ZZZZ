import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/supabase/supabase_providers.dart';
import '../models/geo_point.dart';
import '../models/presence.dart';

/// Localisation temps réel des membres : publication de sa propre position
/// (avec réglage de visibilité) et flux des positions du groupe.
class PresenceRepository {
  PresenceRepository(this._client);

  final SupabaseClient _client;

  /// Flux temps réel des présences d'un groupe.
  ///
  /// Le RLS masque déjà les membres `invisible` ; l'app filtre en plus les
  /// positions périmées ([MemberPresence.isFresh]) côté affichage.
  Stream<List<MemberPresence>> watch(String groupId) {
    return _client
        .from('member_presence')
        .stream(primaryKey: ['group_id', 'user_id'])
        .eq('group_id', groupId)
        .map((rows) => rows.map(MemberPresence.fromMap).toList());
  }

  /// Publie (upsert) sa position courante dans un groupe.
  Future<void> publish({
    required String groupId,
    required GeoPoint position,
    double? heading,
  }) {
    final userId = _client.auth.currentUser!.id;
    return _client.from('member_presence').upsert({
      'group_id': groupId,
      'user_id': userId,
      'geom': {'type': 'Point', 'coordinates': position.toGeoJsonCoords()},
      if (heading != null) 'heading': heading,
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    });
  }

  /// Change son réglage de visibilité (visible / pendant session / invisible).
  Future<void> setVisibility(String groupId, PresenceVisibility visibility) {
    final userId = _client.auth.currentUser!.id;
    return _client.from('member_presence').upsert({
      'group_id': groupId,
      'user_id': userId,
      'visibility': presenceVisibilityToString(visibility),
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    });
  }

  /// Lit son propre réglage de visibilité (défaut : pendant session).
  Future<PresenceVisibility> myVisibility(String groupId) async {
    final userId = _client.auth.currentUser!.id;
    final row = await _client
        .from('member_presence')
        .select('visibility')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .maybeSingle();
    if (row == null) return PresenceVisibility.sessionOnly;
    return presenceVisibilityFromString(row['visibility'] as String);
  }
}

final presenceRepositoryProvider = Provider<PresenceRepository>((ref) {
  return PresenceRepository(ref.watch(supabaseClientProvider));
});

/// Flux des présences d'un groupe (positions live des amis).
final groupPresenceProvider =
    StreamProvider.family<List<MemberPresence>, String>((ref, groupId) {
  return ref.watch(presenceRepositoryProvider).watch(groupId);
});
