import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/supabase/supabase_providers.dart';
import '../models/track.dart';

/// Données géographiques de la carte commune : tracés et zones découvertes,
/// servies en GeoJSON par les vues `tracks_geojson` / `discovered_zones_geojson`.
class MapRepository {
  MapRepository(this._client);

  final SupabaseClient _client;

  /// Tracés du groupe (couche lignes colorées par propriétaire).
  Future<List<Track>> tracks(String groupId) async {
    final rows = await _client
        .from('tracks_geojson')
        .select('id, session_id, group_id, user_id, color, length_m, geometry')
        .eq('group_id', groupId);
    return (rows as List).map((r) {
      final map = Map<String, dynamic>.from(r as Map);
      map['geom'] = map.remove('geometry'); // Track.fromMap attend la clé `geom`
      return Track.fromMap(map);
    }).toList();
  }

  /// Zones découvertes du groupe, en FeatureCollection GeoJSON prête pour
  /// MapLibre (couche qui perce le brouillard d'exploration).
  Future<Map<String, dynamic>> discoveredZonesFeatureCollection(String groupId) async {
    final rows = await _client
        .from('discovered_zones_geojson')
        .select('id, group_id, discovered_by, source, area_m2, geometry')
        .eq('group_id', groupId);
    final features = (rows as List).map((r) {
      final map = Map<String, dynamic>.from(r as Map);
      final geometry = map.remove('geometry');
      return {
        'type': 'Feature',
        'geometry': geometry,
        'properties': map,
      };
    }).toList();
    return {'type': 'FeatureCollection', 'features': features};
  }
}

final mapRepositoryProvider = Provider<MapRepository>((ref) {
  return MapRepository(ref.watch(supabaseClientProvider));
});
