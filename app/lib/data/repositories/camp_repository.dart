import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/supabase/supabase_providers.dart';
import '../models/camp.dart';
import '../models/geo_point.dart';

/// Campements : camp personnel (niche du compagnon) et camps de groupe (admin).
class CampRepository {
  CampRepository(this._client);

  final SupabaseClient _client;

  /// Camps d'un groupe.
  Future<List<Camp>> list(String groupId) async {
    final rows = await _client
        .from('camps')
        .select('id, group_id, owner_id, kind, name, lat, lng, created_at')
        .eq('group_id', groupId)
        .order('created_at');
    return (rows as List).map((r) => Camp.fromMap(r as Map<String, dynamic>)).toList();
  }

  /// Crée un camp de groupe (réservé à l'admin — vérifié par le RLS).
  Future<Camp> createGroupCamp({
    required String groupId,
    required String name,
    required GeoPoint position,
  }) async {
    final row = await _client
        .from('camps')
        .insert({
          'group_id': groupId,
          'kind': 'group',
          'name': name,
          'geom': {'type': 'Point', 'coordinates': position.toGeoJsonCoords()},
        })
        .select('id, group_id, owner_id, kind, name, lat, lng, created_at')
        .single();
    return Camp.fromMap(row);
  }

  /// Crée (ou déplace) son camp personnel — la niche du compagnon.
  Future<Camp> upsertPersonalCamp({
    required String groupId,
    required String name,
    required GeoPoint position,
  }) async {
    final userId = _client.auth.currentUser!.id;

    // Un seul camp personnel par joueur et par groupe : on remplace l'existant.
    final existing = await _client
        .from('camps')
        .select('id')
        .eq('group_id', groupId)
        .eq('kind', 'personal')
        .eq('owner_id', userId)
        .maybeSingle();

    if (existing != null) {
      final row = await _client
          .from('camps')
          .update({
            'name': name,
            'geom': {'type': 'Point', 'coordinates': position.toGeoJsonCoords()},
          })
          .eq('id', existing['id'] as String)
          .select('id, group_id, owner_id, kind, name, lat, lng, created_at')
          .single();
      return Camp.fromMap(row);
    }

    final row = await _client
        .from('camps')
        .insert({
          'group_id': groupId,
          'owner_id': userId,
          'kind': 'personal',
          'name': name,
          'geom': {'type': 'Point', 'coordinates': position.toGeoJsonCoords()},
        })
        .select('id, group_id, owner_id, kind, name, lat, lng, created_at')
        .single();
    return Camp.fromMap(row);
  }

  Future<void> delete(String campId) {
    return _client.from('camps').delete().eq('id', campId);
  }
}

final campRepositoryProvider = Provider<CampRepository>((ref) {
  return CampRepository(ref.watch(supabaseClientProvider));
});

/// Camps d'un groupe.
final campsProvider = FutureProvider.family<List<Camp>, String>((ref, groupId) {
  return ref.watch(campRepositoryProvider).list(groupId);
});
