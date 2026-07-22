import 'dart:async';
import 'dart:io' show Platform;

import 'package:geolocator/geolocator.dart';

/// Service de localisation basé sur `geolocator`.
///
/// Gère les permissions et expose un flux de positions pendant une session.
/// Le suivi **en arrière-plan** (écran verrouillé / veille) est assuré nativement :
/// - Android : foreground service via `foregroundNotificationConfig` ;
/// - iOS : `allowBackgroundLocationUpdates` (background mode `location`).
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

  /// Flux de positions pour le suivi d'une session, avec continuation en
  /// arrière-plan selon la plateforme.
  ///
  /// [distanceFilterM] : distance minimale (mètres) entre deux mises à jour.
  Stream<Position> positionStream({double distanceFilterM = 5}) {
    return Geolocator.getPositionStream(
      locationSettings: _backgroundSettings(distanceFilterM.round()),
    );
  }

  LocationSettings _backgroundSettings(int distanceFilter) {
    if (Platform.isAndroid) {
      return AndroidSettings(
        accuracy: LocationAccuracy.bestForNavigation,
        distanceFilter: distanceFilter,
        forceLocationManager: false,
        // Foreground service : garde le suivi actif écran verrouillé / en veille.
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'Session Gayeulle Party',
          notificationText: 'Exploration en cours…',
          enableWakeLock: true,
          setOngoing: true,
        ),
      );
    }
    if (Platform.isIOS || Platform.isMacOS) {
      return AppleSettings(
        accuracy: LocationAccuracy.bestForNavigation,
        distanceFilter: distanceFilter,
        activityType: ActivityType.fitness,
        allowBackgroundLocationUpdates: true,
        showBackgroundLocationIndicator: true,
        pauseLocationUpdatesAutomatically: false,
      );
    }
    return LocationSettings(
      accuracy: LocationAccuracy.bestForNavigation,
      distanceFilter: distanceFilter,
    );
  }

  /// Distance géodésique (mètres) entre deux points.
  double distanceBetween(double lat1, double lon1, double lat2, double lon2) {
    return Geolocator.distanceBetween(lat1, lon1, lat2, lon2);
  }
}
