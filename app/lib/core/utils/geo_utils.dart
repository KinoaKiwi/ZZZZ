import 'dart:math' as math;

import '../../data/models/geo_point.dart';

/// Outils géographiques côté client (cap, distance simple).
class GeoUtils {
  const GeoUtils._();

  /// Cap initial (bearing, en degrés 0–360, 0 = Nord) de [from] vers [to].
  static double bearing(GeoPoint from, GeoPoint to) {
    final lat1 = _rad(from.lat);
    final lat2 = _rad(to.lat);
    final dLon = _rad(to.lng - from.lng);

    final y = math.sin(dLon) * math.cos(lat2);
    final x = math.cos(lat1) * math.sin(lat2) -
        math.sin(lat1) * math.cos(lat2) * math.cos(dLon);
    final deg = _deg(math.atan2(y, x));
    return (deg + 360) % 360;
  }

  static double _rad(double d) => d * math.pi / 180.0;
  static double _deg(double r) => r * 180.0 / math.pi;
}
