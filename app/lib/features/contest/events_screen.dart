import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/location/location_service.dart';
import '../../core/theme/app_colors.dart';
import '../../data/models/game_event.dart';
import '../../data/models/geo_point.dart';
import '../../data/repositories/contest_repository.dart';
import '../../data/repositories/group_repository.dart';
import 'contest_shop_sheet.dart';
import 'leaderboard_sheet.dart';

/// Événements du groupe : Contest, Contest Boussole, expéditions.
/// L'administrateur (👑) les crée et les lance ; les membres rejoignent.
class EventsScreen extends ConsumerWidget {
  const EventsScreen({super.key, required this.groupId});

  final String groupId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final events = ref.watch(eventsProvider(groupId));
    final isAdmin = ref.watch(isGroupAdminProvider(groupId)).valueOrNull ?? false;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Événements'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/map/$groupId'),
        ),
        actions: [
          IconButton(
            icon: const Text('💰', style: TextStyle(fontSize: 18)),
            tooltip: 'Objets Contest',
            onPressed: () => ContestShopSheet.show(context, groupId: groupId),
          ),
        ],
      ),
      floatingActionButton: isAdmin
          ? FloatingActionButton.extended(
              onPressed: () => _createEvent(context, ref),
              backgroundColor: AppColors.neonViolet,
              foregroundColor: AppColors.background,
              icon: const Icon(Icons.add),
              label: const Text('Créer'),
            )
          : null,
      body: events.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Erreur : $e')),
        data: (list) {
          if (list.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Text(
                  '⚔️\n\nAucun événement.\nL\'admin 👑 peut lancer un Contest,\nun Contest Boussole ou une expédition.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.textSecondary),
                ),
              ),
            );
          }
          return ListView(
            padding: const EdgeInsets.all(12),
            children: [
              for (final e in list)
                _EventCard(event: e, groupId: groupId, isAdmin: isAdmin),
            ],
          );
        },
      ),
    );
  }

  Future<void> _createEvent(BuildContext context, WidgetRef ref) async {
    final kind = await showModalBottomSheet<EventKind>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Type d\'événement',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
            for (final k in EventKind.values)
              ListTile(
                leading: Text(k.emoji, style: const TextStyle(fontSize: 24)),
                title: Text(k.label),
                subtitle: Text(_kindHint(k), style: const TextStyle(fontSize: 12)),
                onTap: () => Navigator.pop(ctx, k),
              ),
          ],
        ),
      ),
    );
    if (kind == null || !context.mounted) return;

    // Pour les modes boussole, la cible = position actuelle de l'admin.
    GeoPoint? target;
    if (kind.isCompass) {
      final loc = LocationService();
      if (await loc.ensurePermission()) {
        final pos = await loc.currentPosition();
        target = GeoPoint(pos.latitude, pos.longitude);
      }
    }

    await ref.read(contestRepositoryProvider).createEvent(
          groupId: groupId,
          kind: kind,
          target: target,
        );
    ref.invalidate(eventsProvider(groupId));
  }

  static String _kindHint(EventKind k) {
    switch (k) {
      case EventKind.contest:
        return 'Compétition : récupère les tracés adverses, objets spéciaux';
      case EventKind.contestCompass:
        return 'Contest + navigation à la flèche, carte cachée';
      case EventKind.expedition:
        return 'Sortie de groupe guidée à la boussole vers un point';
    }
  }
}

class _EventCard extends ConsumerWidget {
  const _EventCard({required this.event, required this.groupId, required this.isAdmin});

  final GameEvent event;
  final String groupId;
  final bool isAdmin;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repo = ref.read(contestRepositoryProvider);
    final statusColor = switch (event.status) {
      EventStatus.active => AppColors.success,
      EventStatus.ended => AppColors.textFaint,
      EventStatus.scheduled => AppColors.neonAmber,
    };

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(event.kind.emoji, style: const TextStyle(fontSize: 26)),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(event.kind.label,
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(event.status.name,
                      style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.w700)),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  icon: const Icon(Icons.group_add, size: 18),
                  label: const Text('Rejoindre'),
                  onPressed: () async {
                    await repo.join(event.id);
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Tu participes ✅')),
                      );
                    }
                  },
                ),
                OutlinedButton.icon(
                  icon: const Icon(Icons.leaderboard, size: 18),
                  label: const Text('Classement'),
                  onPressed: () =>
                      LeaderboardSheet.show(context, eventId: event.id),
                ),
                if (event.kind.isCompass && event.status == EventStatus.active)
                  FilledButton.icon(
                    icon: const Icon(Icons.explore, size: 18),
                    label: const Text('Boussole'),
                    onPressed: () => context.go('/compass/$groupId/${event.id}'),
                  ),
                if (isAdmin && event.status == EventStatus.scheduled)
                  FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: AppColors.success),
                    icon: const Icon(Icons.play_arrow, size: 18),
                    label: const Text('Lancer'),
                    onPressed: () async {
                      await repo.setStatus(event.id, EventStatus.active);
                      ref.invalidate(eventsProvider(groupId));
                    },
                  ),
                if (isAdmin && event.status == EventStatus.active)
                  FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
                    icon: const Icon(Icons.stop, size: 18),
                    label: const Text('Terminer'),
                    onPressed: () async {
                      await repo.setStatus(event.id, EventStatus.ended);
                      ref.invalidate(eventsProvider(groupId));
                    },
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
