import 'geo_point.dart';

/// Le compagnon d'un joueur (table `companions`).
class Companion {
  const Companion({
    required this.id,
    required this.userId,
    required this.groupId,
    required this.species,
    this.den,
  });

  final String id;
  final String userId;
  final String groupId;
  final String species;

  /// Emplacement de la niche (null tant qu'elle n'est pas posée).
  final GeoPoint? den;

  bool get hasDen => den != null;

  factory Companion.fromMap(Map<String, dynamic> map) {
    final lat = map['den_lat'] as num?;
    final lng = map['den_lng'] as num?;
    return Companion(
      id: map['id'] as String,
      userId: map['user_id'] as String,
      groupId: map['group_id'] as String,
      species: (map['species'] as String?) ?? 'default',
      den: (lat != null && lng != null)
          ? GeoPoint(lat.toDouble(), lng.toDouble())
          : null,
    );
  }
}
