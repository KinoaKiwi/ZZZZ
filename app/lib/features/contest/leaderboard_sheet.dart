import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_colors.dart';
import '../../data/models/game_event.dart';
import '../../data/repositories/contest_repository.dart';

/// Classement en direct d'un événement (scores mis à jour par le serveur).
class LeaderboardSheet extends ConsumerWidget {
  const LeaderboardSheet({super.key, required this.eventId});

  final String eventId;

  static Future<void> show(BuildContext context, {required String eventId}) {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (_) => LeaderboardSheet(eventId: eventId),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final standings = ref.watch(_leaderboardProvider(eventId));

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Text('🏆 Classement',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.refresh),
                  onPressed: () => ref.invalidate(_leaderboardProvider(eventId)),
                ),
              ],
            ),
            const SizedBox(height: 4),
            standings.when(
              loading: () => const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (e, _) => Text('Erreur : $e'),
              data: (list) {
                if (list.isEmpty) {
                  return const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('Aucun participant pour l\'instant.',
                        style: TextStyle(color: AppColors.textSecondary)),
                  );
                }
                return Column(
                  children: [
                    for (var i = 0; i < list.length; i++)
                      _StandingRow(rank: i + 1, standing: list[i]),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _StandingRow extends StatelessWidget {
  const _StandingRow({required this.rank, required this.standing});

  final int rank;
  final EventStanding standing;

  @override
  Widget build(BuildContext context) {
    const medals = {1: '🥇', 2: '🥈', 3: '🥉'};
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Text(medals[rank] ?? '$rank.',
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
      title: Text(standing.displayName),
      trailing: Text('${standing.score} pts',
          style: TextStyle(
            color: AppColors.fromHex(standing.color),
            fontWeight: FontWeight.w800,
          )),
    );
  }
}

// Classement enrichi (noms + couleurs). Requête ponctuelle, rafraîchissable :
// le flux Realtime brut ne peut pas joindre les profils.
final _leaderboardProvider =
    FutureProvider.family<List<EventStanding>, String>((ref, eventId) {
  return ref.watch(contestRepositoryProvider).leaderboard(eventId);
});
