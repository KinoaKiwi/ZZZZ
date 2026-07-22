/// Un point géographique simple (WGS84).
class GeoPoint {
  const GeoPoint(this.lat, this.lng);

  final double lat;
  final double lng;

  /// Depuis une géométrie GeoJSON Point : `{ "type": "Point", "coordinates": [lng, lat] }`.
  factory GeoPoint.fromGeoJson(Map<String, dynamic> geo) {
    final coords = (geo['coordinates'] as List).cast<num>();
    return GeoPoint(coords[1].toDouble(), coords[0].toDouble());
  }

  /// Coordonnées GeoJSON `[lng, lat]`.
  List<double> toGeoJsonCoords() => [lng, lat];

  @override
  String toString() => 'GeoPoint($lat, $lng)';
}

/// Une polyligne (suite de points) — le tracé d'une session.
class GeoLine {
  const GeoLine(this.points);

  final List<GeoPoint> points;

  /// Depuis une géométrie GeoJSON LineString.
  factory GeoLine.fromGeoJson(Map<String, dynamic> geo) {
    final coords = (geo['coordinates'] as List).cast<List>();
    return GeoLine(
      coords
          .map((c) => GeoPoint((c[1] as num).toDouble(), (c[0] as num).toDouble()))
          .toList(),
    );
  }

  /// Géométrie GeoJSON LineString.
  Map<String, dynamic> toGeoJson() => {
        'type': 'LineString',
        'coordinates': points.map((p) => p.toGeoJsonCoords()).toList(),
      };

  bool get isEmpty => points.isEmpty;
  int get length => points.length;
}
