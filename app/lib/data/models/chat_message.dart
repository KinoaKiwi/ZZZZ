import 'geo_point.dart';

/// Type d'un message de chat.
enum MessageKind { text, photo, location, poi }

MessageKind messageKindFromString(String value) {
  switch (value) {
    case 'photo':
      return MessageKind.photo;
    case 'location':
      return MessageKind.location;
    case 'poi':
      return MessageKind.poi;
    default:
      return MessageKind.text;
  }
}

/// Un message du chat privé de groupe (table `chat_messages`).
///
/// Pour `kind == photo`, [body] contient le chemin Supabase Storage de l'image
/// (bucket `chat-images`). Pour `kind == location`, [position] est renseigné.
class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.groupId,
    required this.authorId,
    required this.kind,
    this.body,
    this.position,
    this.poiId,
    required this.createdAt,
  });

  final String id;
  final String groupId;
  final String authorId;
  final MessageKind kind;
  final String? body;
  final GeoPoint? position;
  final String? poiId;
  final DateTime createdAt;

  factory ChatMessage.fromMap(Map<String, dynamic> map) {
    final lat = map['lat'] as num?;
    final lng = map['lng'] as num?;
    return ChatMessage(
      id: map['id'] as String,
      groupId: map['group_id'] as String,
      authorId: map['author_id'] as String,
      kind: messageKindFromString(map['kind'] as String? ?? 'text'),
      body: map['body'] as String?,
      position: (lat != null && lng != null)
          ? GeoPoint(lat.toDouble(), lng.toDouble())
          : null,
      poiId: map['poi_id'] as String?,
      createdAt: DateTime.parse(map['created_at'] as String),
    );
  }
}
