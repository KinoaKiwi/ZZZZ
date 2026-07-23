import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../core/supabase/supabase_providers.dart';
import '../models/geo_point.dart';
import '../models/poi.dart';

/// Points d'intérêt, photos et souvenirs géolocalisés.
class PoiRepository {
  PoiRepository(this._client);

  final SupabaseClient _client;

  static const _bucket = 'poi-images';

  /// POI d'un groupe (avec leurs images).
  Future<List<PointOfInterest>> list(String groupId) async {
    final rows = await _client
        .from('points_of_interest')
        .select('id, group_id, author_id, kind, title, lat, lng, created_at, '
            'poi_images(storage_path)')
        .eq('group_id', groupId)
        .order('created_at', ascending: false);
    return (rows as List)
        .map((r) => PointOfInterest.fromMap(r as Map<String, dynamic>))
        .toList();
  }

  /// Crée un POI (photo / lieu / souvenir) et téléverse ses images éventuelles.
  Future<PointOfInterest> create({
    required String groupId,
    required PoiKind kind,
    required GeoPoint position,
    String? title,
    List<File> images = const <File>[],
  }) async {
    final userId = _client.auth.currentUser!.id;

    final row = await _client
        .from('points_of_interest')
        .insert({
          'group_id': groupId,
          'author_id': userId,
          'kind': kind.name,
          'title': title,
          'geom': {
            'type': 'Point',
            'coordinates': position.toGeoJsonCoords(),
          },
        })
        .select('id, group_id, author_id, kind, title, lat, lng, created_at')
        .single();

    final poiId = row['id'] as String;
    final paths = <String>[];

    for (final image in images) {
      // Convention : <group_id>/<poi_id>/<uuid>.jpg (policy Storage par groupe).
      final path = '$groupId/$poiId/${const Uuid().v4()}.jpg';
      await _client.storage.from(_bucket).upload(path, image);
      await _client.from('poi_images').insert({
        'poi_id': poiId,
        'storage_path': path,
      });
      paths.add(path);
    }

    final map = Map<String, dynamic>.from(row);
    map['poi_images'] = paths.map((p) => {'storage_path': p}).toList();
    return PointOfInterest.fromMap(map);
  }

  /// URL signée (temporaire) pour afficher une image de POI.
  Future<String> signedImageUrl(String storagePath) {
    return _client.storage.from(_bucket).createSignedUrl(storagePath, 3600);
  }
}

final poiRepositoryProvider = Provider<PoiRepository>((ref) {
  return PoiRepository(ref.watch(supabaseClientProvider));
});

/// POI d'un groupe (rafraîchis à la demande via invalidate).
final poisProvider =
    FutureProvider.family<List<PointOfInterest>, String>((ref, groupId) {
  return ref.watch(poiRepositoryProvider).list(groupId);
});
