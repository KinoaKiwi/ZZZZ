import 'geo_point.dart';

/// Type de campement.
enum CampKind { personal, group }

CampKind campKindFromString(String value) =>
    value == 'group' ? CampKind.group : CampKind.personal;

/// Un campement (table `camps`).
///
/// - `personal` : la niche du compagnon d'un joueur ;
/// - `group` : créé par l'administrateur (rendez-vous, départ d'expédition,
///   lieu souvenir).
class Camp {
  const Camp({
    required this.id,
    required this.groupId,
    this.ownerId,
    required this.kind,
    required this.name,
    required this.position,
    required this.createdAt,
  });

  final String id;
  final String groupId;

  /// Null pour un camp de groupe.
  final String? ownerId;
  final CampKind kind;
  final String name;
  final GeoPoint position;
  final DateTime createdAt;

  factory Camp.fromMap(Map<String, dynamic> map) {
    return Camp(
      id: map['id'] as String,
      groupId: map['group_id'] as String,
      ownerId: map['owner_id'] as String?,
      kind: campKindFromString(map['kind'] as String? ?? 'personal'),
      name: map['name'] as String,
      position: GeoPoint(
        (map['lat'] as num).toDouble(),
        (map['lng'] as num).toDouble(),
      ),
      createdAt: DateTime.parse(map['created_at'] as String),
    );
  }
}
