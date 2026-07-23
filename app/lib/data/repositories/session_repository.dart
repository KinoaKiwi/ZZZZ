import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../core/supabase/supabase_providers.dart';
import '../models/exploration_session.dart';
import '../models/geo_point.dart';

/// Création et clôture des sessions d'exploration + enregistrement du tracé.
class SessionRepository {
  SessionRepository(this._client);

  final SupabaseClient _client;

  /// Démarre une session (statut `active`).
  Future<ExplorationSession> startSession(String groupId) async {
    final userId = _client.auth.currentUser!.id;
    final row = await _client
        .from('exploration_sessions')
        .insert({'group_id': groupId, 'user_id': userId})
        .select()
        .single();
    return ExplorationSession.fromMap(row);
  }

  /// Enregistre le tracé de la session (polyligne GPS) et sa couleur.
  ///
  /// `geom` est fourni en GeoJSON ; côté SQL, la colonne est
  /// `geography(LineString,4326)` — PostgREST accepte le GeoJSON à l'insertion.
  Future<void> saveTrack({
    required String sessionId,
    required String groupId,
    required GeoLine line,
    required String color,
  }) async {
    if (line.length < 2) return; // pas de tracé exploitable
    final userId = _client.auth.currentUser!.id;
    await _client.from('tracks').insert({
      'session_id': sessionId,
      'group_id': groupId,
      'user_id': userId,
      'color': color,
      'geom': line.toGeoJson(),
    });
  }

  /// Clôture la session côté serveur : fige les métriques et révèle la zone
  /// à partir du tracé (RPC `finish_session`).
  Future<ExplorationSession> finishSession({
    required String sessionId,
    required double distanceM,
    required int steps,
    required int durationS,
  }) async {
    final data = await _client.rpc('finish_session', params: {
      'p_session_id': sessionId,
      'p_distance_m': distanceM,
      'p_steps': steps,
      'p_duration_s': durationS,
    });
    final row = data is List ? data.first as Map<String, dynamic> : data as Map<String, dynamic>;
    return ExplorationSession.fromMap(row);
  }

  /// Attache une photo souvenir à une session (bucket `session-photos`).
  Future<void> addPhoto({
    required String sessionId,
    required String groupId,
    required File image,
  }) async {
    final path = '$groupId/$sessionId/${const Uuid().v4()}.jpg';
    await _client.storage.from('session-photos').upload(path, image);
    await _client.from('session_photos').insert({
      'session_id': sessionId,
      'group_id': groupId,
      'storage_path': path,
    });
  }
}

final sessionRepositoryProvider = Provider<SessionRepository>((ref) {
  return SessionRepository(ref.watch(supabaseClientProvider));
});
