import 'geo_point.dart';

/// Type d'un point d'intérêt.
enum PoiKind { photo, place, memory }

PoiKind poiKindFromString(String value) {
  switch (value) {
    case 'photo':
      return PoiKind.photo;
    case 'memory':
      return PoiKind.memory;
    default:
      return PoiKind.place;
  }
}

/// Un point d'intérêt / souvenir géolocalisé (table `points_of_interest`).
class PointOfInterest {
  const PointOfInterest({
    required this.id,
    required this.groupId,
    required this.authorId,
    required this.kind,
    required this.position,
    this.title,
    this.imagePaths = const <String>[],
    required this.createdAt,
  });

  final String id;
  final String groupId;
  final String authorId;
  final PoiKind kind;
  final GeoPoint position;
  final String? title;

  /// Chemins Supabase Storage des images (bucket `poi-images`).
  final List<String> imagePaths;
  final DateTime createdAt;

  factory PointOfInterest.fromMap(Map<String, dynamic> map) {
    final images = (map['poi_images'] as List?)
            ?.map((r) => (r as Map)['storage_path'] as String)
            .toList() ??
        const <String>[];
    return PointOfInterest(
      id: map['id'] as String,
      groupId: map['group_id'] as String,
      authorId: map['author_id'] as String,
      kind: poiKindFromString(map['kind'] as String? ?? 'place'),
      position: GeoPoint(
        (map['lat'] as num).toDouble(),
        (map['lng'] as num).toDouble(),
      ),
      title: map['title'] as String?,
      imagePaths: images,
      createdAt: DateTime.parse(map['created_at'] as String),
    );
  }
}
