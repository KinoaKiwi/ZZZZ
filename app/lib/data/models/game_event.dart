import 'geo_point.dart';

/// Type d'événement (créé par l'administrateur).
enum EventKind { contest, contestCompass, expedition }

EventKind eventKindFromString(String value) {
  switch (value) {
    case 'contest_compass':
      return EventKind.contestCompass;
    case 'expedition':
      return EventKind.expedition;
    default:
      return EventKind.contest;
  }
}

String eventKindToString(EventKind kind) {
  switch (kind) {
    case EventKind.contestCompass:
      return 'contest_compass';
    case EventKind.expedition:
      return 'expedition';
    case EventKind.contest:
      return 'contest';
  }
}

extension EventKindLabel on EventKind {
  String get label {
    switch (this) {
      case EventKind.contest:
        return 'Contest';
      case EventKind.contestCompass:
        return 'Contest Boussole';
      case EventKind.expedition:
        return 'Expédition';
    }
  }

  String get emoji {
    switch (this) {
      case EventKind.contest:
        return '⚔️';
      case EventKind.contestCompass:
        return '🧭';
      case EventKind.expedition:
        return '🥾';
    }
  }

  /// Un mode boussole (navigation à la flèche, sans carte).
  bool get isCompass =>
      this == EventKind.contestCompass || this == EventKind.expedition;

  bool get isContest =>
      this == EventKind.contest || this == EventKind.contestCompass;
}

/// Statut d'un événement.
enum EventStatus { scheduled, active, ended }

EventStatus eventStatusFromString(String value) {
  switch (value) {
    case 'active':
      return EventStatus.active;
    case 'ended':
      return EventStatus.ended;
    default:
      return EventStatus.scheduled;
  }
}

String eventStatusToString(EventStatus s) {
  switch (s) {
    case EventStatus.active:
      return 'active';
    case EventStatus.ended:
      return 'ended';
    case EventStatus.scheduled:
      return 'scheduled';
  }
}

/// Un événement du groupe (table `events`).
class GameEvent {
  const GameEvent({
    required this.id,
    required this.groupId,
    required this.createdBy,
    required this.kind,
    required this.status,
    this.rules = const {},
  });

  final String id;
  final String groupId;
  final String createdBy;
  final EventKind kind;
  final EventStatus status;
  final Map<String, dynamic> rules;

  /// Cible de navigation (Mode Boussole), si définie dans les règles.
  GeoPoint? get target {
    final t = rules['target'];
    if (t is Map && t['lat'] != null && t['lng'] != null) {
      return GeoPoint((t['lat'] as num).toDouble(), (t['lng'] as num).toDouble());
    }
    return null;
  }

  factory GameEvent.fromMap(Map<String, dynamic> map) {
    return GameEvent(
      id: map['id'] as String,
      groupId: map['group_id'] as String,
      createdBy: map['created_by'] as String,
      kind: eventKindFromString(map['kind'] as String),
      status: eventStatusFromString(map['status'] as String),
      rules: (map['rules'] as Map?)?.cast<String, dynamic>() ?? const {},
    );
  }
}

/// Un participant à un événement, avec son score (table `event_participants`).
class EventStanding {
  const EventStanding({
    required this.userId,
    required this.displayName,
    required this.color,
    required this.score,
  });

  final String userId;
  final String displayName;
  final String color;
  final int score;

  factory EventStanding.fromMap(Map<String, dynamic> map) {
    final profile = (map['profiles'] as Map?)?.cast<String, dynamic>();
    return EventStanding(
      userId: map['user_id'] as String,
      displayName: (profile?['display_name'] as String?) ?? '…',
      color: (profile?['color'] as String?) ?? '#6EE7F0',
      score: (map['score'] as num?)?.toInt() ?? 0,
    );
  }
}
