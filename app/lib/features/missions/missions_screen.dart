import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../data/models/mission.dart';
import '../../data/repositories/mission_repository.dart';
import '../economy/widgets/coin_chip.dart';

/// Missions journalières : avancement et réclamation des Djadja Coins.
class MissionsScreen extends ConsumerWidget {
  const MissionsScreen({super.key, required this.groupId});

  final String groupId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final missions = ref.watch(missionsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Missions du jour'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/map/$groupId'),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Center(child: CoinChip(groupId: groupId)),
          ),
        ],
      ),
      body: missions.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Erreur : $e')),
        data: (list) => ListView(
          padding: const EdgeInsets.all(12),
          children: [
            for (final m in list) _MissionCard(mission: m, groupId: groupId),
          ],
        ),
      ),
    );
  }
}

class _MissionCard extends ConsumerStatefulWidget {
  const _MissionCard({required this.mission, required this.groupId});

  final Mission mission;
  final String groupId;

  @override
  ConsumerState<_MissionCard> createState() => _MissionCardState();
}

class _MissionCardState extends ConsumerState<_MissionCard> {
  bool _claiming = false;

  Future<void> _claim() async {
    setState(() => _claiming = true);
    try {
      await ref.read(missionRepositoryProvider).claim(widget.mission.id, widget.groupId);
      ref.invalidate(missionsProvider);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _claiming = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.mission;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(m.title,
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                ),
                Text('🪙 ${m.reward}',
                    style: const TextStyle(color: AppColors.neonAmber, fontWeight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: LinearProgressIndicator(
                value: m.ratio,
                minHeight: 8,
                backgroundColor: AppColors.surfaceHigh,
                valueColor: AlwaysStoppedAnimation(
                  m.completed ? AppColors.success : AppColors.neonCyan,
                ),
              ),
            ),
            const SizedBox(height: 6),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${m.progress} / ${m.goal}',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                if (m.claimed)
                  const Text('✅ Récupéré',
                      style: TextStyle(color: AppColors.success, fontSize: 12))
                else if (m.claimable)
                  SizedBox(
                    height: 34,
                    child: FilledButton(
                      onPressed: _claiming ? null : _claim,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.neonAmber,
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                      ),
                      child: _claiming
                          ? const SizedBox(
                              height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('Récupérer'),
                    ),
                  )
                else
                  const Text('En cours…',
                      style: TextStyle(color: AppColors.textFaint, fontSize: 12)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
