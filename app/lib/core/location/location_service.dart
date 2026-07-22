import 'dart:async';

import 'package:geolocator/geolocator.dart';

/// Service de localisation basé sur `geolocator`.
///
/// Gère les permissions et expose un flux de positions pendant une session
/// d'exploration. Le suivi en arrière-plan (écran verrouillé / veille) est
/// assuré par un foreground service (Android) et les background modes (iOS) —
/// voir docs/ARCHITECTURE.md §2.4.
class LocationService {
  /// Demande la permission de localisation « always » requise pour les sessions
  /// en arrière-plan. Retourne true si accordée.
  Future<bool> ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return false;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.deniedForever ||
        permission == LocationPermission.denied) {
      return false;
    }
    return true;
  }

  /// Position ponctuelle actuelle (pour centrer la carte au démarrage).
  Future<Position> currentPosition() {
    return Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    );
  }

  /// Flux de positions pour le suivi d'une session.
  ///
  /// [distanceFilterM] : distance minimale (mètres) entre deux mises à jour.
  Stream<Position> positionStream({double distanceFilterM = 5}) {
    return Geolocator.getPositionStream(
      locationSettings: LocationSettings(
        accuracy: LocationAccuracy.bestForNavigation,
        distanceFilter: distanceFilterM.round(),
      ),
    );
  }

  /// Distance géodésique (mètres) entre deux points.
  double distanceBetween(double lat1, double lon1, double lat2, double lon2) {
    return Geolocator.distanceBetween(lat1, lon1, lat2, lon2);
  }
}
