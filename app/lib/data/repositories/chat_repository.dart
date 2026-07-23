import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../core/supabase/supabase_providers.dart';
import '../models/chat_message.dart';
import '../models/geo_point.dart';

/// Chat privé du groupe : messages, photos, positions, lieux — en temps réel.
class ChatRepository {
  ChatRepository(this._client);

  final SupabaseClient _client;

  static const _bucket = 'chat-images';

  /// Flux temps réel des messages d'un groupe (les plus récents en dernier).
  Stream<List<ChatMessage>> messages(String groupId) {
    return _client
        .from('chat_messages')
        .stream(primaryKey: ['id'])
        .eq('group_id', groupId)
        .order('created_at', ascending: true)
        .map((rows) => rows.map(ChatMessage.fromMap).toList());
  }

  /// Envoie un message texte.
  Future<void> sendText(String groupId, String body) {
    return _insert(groupId, kind: 'text', body: body);
  }

  /// Envoie une photo : téléverse l'image puis référence son chemin en `body`.
  Future<void> sendPhoto(String groupId, File image, {String? caption}) async {
    final path = '$groupId/${const Uuid().v4()}.jpg';
    await _client.storage.from(_bucket).upload(path, image);
    await _insert(groupId, kind: 'photo', body: path);
    if (caption != null && caption.isNotEmpty) {
      await _insert(groupId, kind: 'text', body: caption);
    }
  }

  /// Partage une position.
  Future<void> sendLocation(String groupId, GeoPoint position) {
    return _insert(
      groupId,
      kind: 'location',
      geom: {'type': 'Point', 'coordinates': position.toGeoJsonCoords()},
    );
  }

  /// Partage un lieu (POI existant).
  Future<void> sendPoi(String groupId, String poiId) {
    return _insert(groupId, kind: 'poi', poiId: poiId);
  }

  Future<void> _insert(
    String groupId, {
    required String kind,
    String? body,
    Map<String, dynamic>? geom,
    String? poiId,
  }) {
    final userId = _client.auth.currentUser!.id;
    return _client.from('chat_messages').insert({
      'group_id': groupId,
      'author_id': userId,
      'kind': kind,
      if (body != null) 'body': body,
      if (geom != null) 'geom': geom,
      if (poiId != null) 'poi_id': poiId,
    });
  }

  /// URL signée pour afficher une photo de chat.
  Future<String> signedImageUrl(String storagePath) {
    return _client.storage.from(_bucket).createSignedUrl(storagePath, 3600);
  }
}

final chatRepositoryProvider = Provider<ChatRepository>((ref) {
  return ChatRepository(ref.watch(supabaseClientProvider));
});

/// Flux des messages d'un groupe.
final chatMessagesProvider =
    StreamProvider.family<List<ChatMessage>, String>((ref, groupId) {
  return ref.watch(chatRepositoryProvider).messages(groupId);
});
