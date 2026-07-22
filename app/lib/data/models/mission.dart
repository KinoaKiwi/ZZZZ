/// Une mission journalière avec l'avancement du joueur (jointure
/// `daily_missions` + `mission_progress`).
class Mission {
  const Mission({
    required this.id,
    required this.code,
    required this.title,
    required this.category,
    required this.goal,
    required this.reward,
    this.progress = 0,
    this.completed = false,
    this.claimed = false,
  });

  final String id;
  final String code;
  final String title;
  final String category;
  final int goal;
  final int reward;
  final int progress;
  final bool completed;
  final bool claimed;

  double get ratio => goal == 0 ? 0 : (progress / goal).clamp(0, 1).toDouble();

  /// Terminée mais récompense pas encore réclamée.
  bool get claimable => completed && !claimed;

  factory Mission.fromMap(Map<String, dynamic> map) {
    // `mission_progress` peut être null (mission non commencée) ou une liste.
    final rawProgress = map['mission_progress'];
    Map<String, dynamic>? prog;
    if (rawProgress is List && rawProgress.isNotEmpty) {
      prog = Map<String, dynamic>.from(rawProgress.first as Map);
    } else if (rawProgress is Map) {
      prog = Map<String, dynamic>.from(rawProgress);
    }

    return Mission(
      id: map['id'] as String,
      code: map['code'] as String,
      title: map['title'] as String,
      category: map['category'] as String? ?? 'walk',
      goal: (map['goal'] as num).toInt(),
      reward: (map['reward'] as num).toInt(),
      progress: (prog?['progress'] as num?)?.toInt() ?? 0,
      completed: prog?['completed_at'] != null,
      claimed: (prog?['claimed'] as bool?) ?? false,
    );
  }
}
