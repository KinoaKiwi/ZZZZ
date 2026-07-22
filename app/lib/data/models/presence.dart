import 'geo_point.dart';

/// Réglage de visibilité de la position d'un membre.
enum PresenceVisibility { visible, sessionOnly, invisible }

PresenceVisibility presenceVisibilityFromString(String value) {
  switch (value) {
    case 'visible':
      return PresenceVisibility.visible;
    case 'invisible':
      return PresenceVisibility.invisible;
    default:
      return PresenceVisibility.sessionOnly;
  }
}

String presenceVisibilityToString(PresenceVisibility v) {
  switch (v) {
    case PresenceVisibility.visible:
      return 'visible';
    case PresenceVisibility.invisible:
      return 'invisible';
    case PresenceVisibility.sessionOnly:
      return 'session_only';
  }
}

/// Dernière position connue d'un membre + visibilité (table `member_presence`).
class MemberPresence {
  const MemberPresence({
    required this.groupId,
    required this.userId,
    this.position,
    this.heading,
    required this.visibility,
    required this.updatedAt,
  });

  final String groupId;
  final String userId;
  final GeoPoint? position;
  final double? heading;
  final PresenceVisibility visibility;
  final DateTime updatedAt;

  /// Position considérée « fraîche » (moins de 5 minutes).
  bool get isFresh => DateTime.now().difference(updatedAt).inMinutes < 5;

  factory MemberPresence.fromMap(Map<String, dynamic> map) {
    final lat = map['lat'] as num?;
    final lng = map['lng'] as num?;
    return MemberPresence(
      groupId: map['group_id'] as String,
      userId: map['user_id'] as String,
      position: (lat != null && lng != null)
          ? GeoPoint(lat.toDouble(), lng.toDouble())
          : null,
      heading: (map['heading'] as num?)?.toDouble(),
      visibility: presenceVisibilityFromString(
        map['visibility'] as String? ?? 'session_only',
      ),
      updatedAt: DateTime.parse(map['updated_at'] as String),
    );
  }
}
