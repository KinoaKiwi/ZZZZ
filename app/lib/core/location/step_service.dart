import 'dart:async';

import 'package:pedometer/pedometer.dart';

/// Compteur de pas basé sur `pedometer` (capteur natif ; sous le capot
/// HealthKit sur iOS et Health Connect / Step Counter sur Android).
///
/// Le capteur renvoie un cumul depuis le dernier redémarrage de l'appareil :
/// on mémorise le nombre de pas au début de la session et on expose le delta.
class StepService {
  int? _baseline;
  StreamSubscription<StepCount>? _subscription;
  final _controller = StreamController<int>.broadcast();

  /// Pas comptés depuis [start] (0 tant qu'aucune mesure n'est arrivée).
  Stream<int> get steps => _controller.stream;

  /// Démarre le comptage pour une session.
  void start() {
    _baseline = null;
    _subscription = Pedometer.stepCountStream.listen(
      (event) {
        _baseline ??= event.steps;
        _controller.add(event.steps - _baseline!);
      },
      onError: (_) => _controller.add(0),
      cancelOnError: false,
    );
  }

  /// Arrête le comptage et libère la souscription.
  Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
  }

  Future<void> dispose() async {
    await stop();
    await _controller.close();
  }
}
