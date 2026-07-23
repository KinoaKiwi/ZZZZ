/// Statut d'une session d'exploration.
enum SessionStatus { active, finished, discarded }

SessionStatus sessionStatusFromString(String value) {
  switch (value) {
    case 'finished':
      return SessionStatus.finished;
    case 'discarded':
      return SessionStatus.discarded;
    default:
      return SessionStatus.active;
  }
}

/// Une session de marche (table `exploration_sessions`).
class ExplorationSession {
  const ExplorationSession({
    required this.id,
    required this.groupId,
    required this.userId,
    required this.startedAt,
    this.endedAt,
    this.distanceM = 0,
    this.steps = 0,
    this.durationS = 0,
    this.status = SessionStatus.active,
  });

  final String id;
  final String groupId;
  final String userId;
  final DateTime startedAt;
  final DateTime? endedAt;
  final double distanceM;
  final int steps;
  final int durationS;
  final SessionStatus status;

  factory ExplorationSession.fromMap(Map<String, dynamic> map) {
    return ExplorationSession(
      id: map['id'] as String,
      groupId: map['group_id'] as String,
      userId: map['user_id'] as String,
      startedAt: DateTime.parse(map['started_at'] as String),
      endedAt: map['ended_at'] == null ? null : DateTime.parse(map['ended_at'] as String),
      distanceM: (map['distance_m'] as num?)?.toDouble() ?? 0,
      steps: (map['steps'] as num?)?.toInt() ?? 0,
      durationS: (map['duration_s'] as num?)?.toInt() ?? 0,
      status: sessionStatusFromString(map['status'] as String? ?? 'active'),
    );
  }

  double get distanceKm => distanceM / 1000;
}
