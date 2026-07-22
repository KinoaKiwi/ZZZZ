import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/config/constants.dart';
import '../../core/location/location_service.dart';
import '../../core/location/step_service.dart';
import '../../data/models/exploration_session.dart';
import '../../data/models/geo_point.dart';
import '../../data/repositories/session_repository.dart';

/// Phase d'une session côté UI.
enum SessionPhase { idle, running, saving, finished }

/// État observable d'une session d'exploration en cours.
class SessionState {
  const SessionState({
    this.phase = SessionPhase.idle,
    this.session,
    this.points = const <GeoPoint>[],
    this.distanceM = 0,
    this.steps = 0,
    this.elapsed = Duration.zero,
    this.summary,
    this.error,
  });

  final SessionPhase phase;
  final ExplorationSession? session;
  final List<GeoPoint> points;
  final double distanceM;
  final int steps;
  final Duration elapsed;

  /// Session clôturée (avec métriques figées) une fois terminée.
  final ExplorationSession? summary;
  final String? error;

  bool get isRunning => phase == SessionPhase.running;
  double get distanceKm => distanceM / 1000;

  SessionState copyWith({
    SessionPhase? phase,
    ExplorationSession? session,
    List<GeoPoint>? points,
    double? distanceM,
    int? steps,
    Duration? elapsed,
    ExplorationSession? summary,
    String? error,
  }) {
    return SessionState(
      phase: phase ?? this.phase,
      session: session ?? this.session,
      points: points ?? this.points,
      distanceM: distanceM ?? this.distanceM,
      steps: steps ?? this.steps,
      elapsed: elapsed ?? this.elapsed,
      summary: summary ?? this.summary,
      error: error,
    );
  }
}

/// Pilote une session d'exploration : GPS + pas + distance + durée + tracé,
/// puis clôture serveur (métriques figées, zone révélée).
class SessionController extends StateNotifier<SessionState> {
  SessionController(this._ref) : super(const SessionState());

  final Ref _ref;
  final LocationService _location = LocationService();
  final StepService _steps = StepService();

  StreamSubscription<Position>? _posSub;
  StreamSubscription<int>? _stepSub;
  Timer? _ticker;
  DateTime? _startedAt;

  /// Démarre une session pour [groupId] avec la [color] du joueur.
  Future<void> start(String groupId, {required String color}) async {
    if (state.isRunning) return;

    final granted = await _location.ensurePermission();
    if (!granted) {
      state = state.copyWith(error: 'Permission de localisation requise pour explorer.');
      return;
    }

    try {
      final session = await _ref.read(sessionRepositoryProvider).startSession(groupId);
      _startedAt = DateTime.now();
      _color = color;
      _groupId = groupId;

      state = SessionState(phase: SessionPhase.running, session: session);

      _steps.start();
      _stepSub = _steps.steps.listen((s) => state = state.copyWith(steps: s));

      _posSub = _location
          .positionStream(distanceFilterM: GameConstants.minPointDistanceM)
          .listen(_onPosition);

      _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
        state = state.copyWith(elapsed: DateTime.now().difference(_startedAt!));
      });
    } catch (e) {
      state = state.copyWith(error: 'Impossible de démarrer la session : $e');
    }
  }

  late String _color;
  late String _groupId;

  /// Ajoute un point GPS au tracé, avec filtrage (précision, distance, vitesse).
  void _onPosition(Position pos) {
    if (pos.accuracy > GameConstants.maxAcceptableAccuracyM) return;

    final point = GeoPoint(pos.latitude, pos.longitude);
    final points = List<GeoPoint>.from(state.points);

    if (points.isNotEmpty) {
      final last = points.last;
      final d = _location.distanceBetween(last.lat, last.lng, point.lat, point.lng);
      if (d < GameConstants.minPointDistanceM) return; // bruit à l'arrêt

      // Anti-triche léger : rejette une vitesse incompatible avec la marche.
      if (pos.speed.isFinite && pos.speed > GameConstants.maxWalkingSpeedMps) return;

      state = state.copyWith(distanceM: state.distanceM + d);
    }

    points.add(point);
    state = state.copyWith(points: points);
  }

  /// Arrête la session : sauvegarde le tracé et clôture côté serveur.
  Future<void> stop() async {
    if (!state.isRunning) return;
    state = state.copyWith(phase: SessionPhase.saving);

    await _posSub?.cancel();
    await _stepSub?.cancel();
    await _steps.stop();
    _ticker?.cancel();

    final session = state.session!;
    final repo = _ref.read(sessionRepositoryProvider);

    try {
      await repo.saveTrack(
        sessionId: session.id,
        groupId: _groupId,
        line: GeoLine(state.points),
        color: _color,
      );

      final summary = await repo.finishSession(
        sessionId: session.id,
        distanceM: state.distanceM,
        steps: state.steps,
        durationS: state.elapsed.inSeconds,
      );

      state = state.copyWith(phase: SessionPhase.finished, summary: summary);
    } catch (e) {
      state = state.copyWith(phase: SessionPhase.finished, error: 'Erreur à la clôture : $e');
    }
  }

  /// Réinitialise pour une nouvelle session.
  void reset() => state = const SessionState();

  @override
  void dispose() {
    _posSub?.cancel();
    _stepSub?.cancel();
    _ticker?.cancel();
    _steps.dispose();
    super.dispose();
  }
}

final sessionControllerProvider =
    StateNotifierProvider<SessionController, SessionState>((ref) {
  return SessionController(ref);
});
