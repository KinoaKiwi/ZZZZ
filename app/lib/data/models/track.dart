import 'geo_point.dart';

/// Le tracé d'une session : une polyligne appartenant à un joueur (table `tracks`).
class Track {
  const Track({
    required this.id,
    required this.sessionId,
    required this.groupId,
    required this.userId,
    required this.line,
    required this.color,
    required this.lengthM,
  });

  final String id;
  final String sessionId;
  final String groupId;

  /// Propriétaire du tracé (garde son propriétaire même en Contest).
  final String userId;
  final GeoLine line;
  final String color;
  final double lengthM;

  factory Track.fromMap(Map<String, dynamic> map) {
    // `geom` est renvoyé en GeoJSON via ST_AsGeoJSON côté requête.
    final geo = map['geom'];
    final line = geo is Map<String, dynamic>
        ? GeoLine.fromGeoJson(geo)
        : const GeoLine(<GeoPoint>[]);
    return Track(
      id: map['id'] as String,
      sessionId: map['session_id'] as String,
      groupId: map['group_id'] as String,
      userId: map['user_id'] as String,
      line: line,
      color: (map['color'] as String?) ?? '#6EE7F0',
      lengthM: (map['length_m'] as num?)?.toDouble() ?? 0,
    );
  }
}
