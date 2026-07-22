import 'package:flutter_test/flutter_test.dart';
import 'package:gayeulle_party/core/theme/app_colors.dart';
import 'package:gayeulle_party/data/models/geo_point.dart';

void main() {
  group('GeoPoint / GeoLine GeoJSON', () {
    test('GeoPoint round-trips lng/lat order', () {
      const point = GeoPoint(48.8566, 2.3522);
      final coords = point.toGeoJsonCoords();
      expect(coords, [2.3522, 48.8566]); // GeoJSON = [lng, lat]

      final parsed = GeoPoint.fromGeoJson({'type': 'Point', 'coordinates': coords});
      expect(parsed.lat, closeTo(48.8566, 1e-9));
      expect(parsed.lng, closeTo(2.3522, 1e-9));
    });

    test('GeoLine serializes to a LineString', () {
      const line = GeoLine([GeoPoint(48.0, 2.0), GeoPoint(48.1, 2.1)]);
      final geo = line.toGeoJson();
      expect(geo['type'], 'LineString');
      expect((geo['coordinates'] as List).length, 2);
      expect((geo['coordinates'] as List).first, [2.0, 48.0]);
    });

    test('GeoLine parses a LineString', () {
      final line = GeoLine.fromGeoJson({
        'type': 'LineString',
        'coordinates': [
          [2.0, 48.0],
          [2.1, 48.1],
        ],
      });
      expect(line.length, 2);
      expect(line.points.first.lat, 48.0);
      expect(line.points.last.lng, 2.1);
    });
  });

  group('AppColors.fromHex', () {
    test('parses #RRGGBB', () {
      final c = AppColors.fromHex('#6EE7F0');
      expect(c.value, 0xFF6EE7F0);
    });

    test('parses without leading #', () {
      final c = AppColors.fromHex('F06EC8');
      expect(c.value, 0xFFF06EC8);
    });
  });
}
