import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/config/feature_flags.dart';
import '../../core/theme/app_colors.dart';
import '../../data/repositories/auth_repository.dart';
import '../../data/repositories/economy_repository.dart';
import '../../data/repositories/session_repository.dart';
import 'session_controller.dart';

/// Écran d'une session d'exploration : démarrage, stats en direct, résumé.
class SessionScreen extends ConsumerWidget {
  const SessionScreen({super.key, required this.groupId});

  final String groupId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(sessionControllerProvider);
    final controller = ref.read(sessionControllerProvider.notifier);

    if (state.phase == SessionPhase.finished) {
      return _SummaryView(groupId: groupId);
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Session d\'exploration'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: state.isRunning ? null : () => context.go('/map/$groupId'),
        ),
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            const SizedBox(height: 12),
            Row(
              children: [
                _Stat(label: 'Distance', value: '${state.distanceKm.toStringAsFixed(2)} km'),
                _Stat(label: 'Pas', value: '${state.steps}'),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                _Stat(label: 'Durée', value: _fmt(state.elapsed)),
                _Stat(label: 'Points', value: '${state.points.length}'),
              ],
            ),
            if (state.error != null) ...[
              const SizedBox(height: 16),
              Text(state.error!, style: const TextStyle(color: AppColors.danger)),
            ],
            const Spacer(),
            if (!state.isRunning && state.phase == SessionPhase.idle)
              FilledButton.icon(
                icon: const Icon(Icons.play_arrow),
                label: const Text('Commencer'),
                onPressed: () async {
                  final profile = await ref.read(currentProfileProvider.future);
                  await controller.start(groupId, color: profile?.color ?? '#6EE7F0');
                },
              )
            else if (state.phase == SessionPhase.saving)
              const FilledButton(onPressed: null, child: Text('Sauvegarde…'))
            else
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
                icon: const Icon(Icons.stop),
                label: const Text('Terminer la session'),
                onPressed: controller.stop,
              ),
            const SizedBox(height: 8),
            const Text(
              'La session continue écran verrouillé et téléphone en veille.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textFaint, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }

  static String _fmt(Duration d) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.inHours)}:${two(d.inMinutes % 60)}:${two(d.inSeconds % 60)}';
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 20),
          child: Column(
            children: [
              Text(
                value,
                style: const TextStyle(
                  fontSize: 26, fontWeight: FontWeight.w800, color: AppColors.neonCyan,
                ),
              ),
              const SizedBox(height: 4),
              Text(label, style: const TextStyle(color: AppColors.textSecondary)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Résumé de fin de session (km · pas · durée · nouvelles zones).
class _SummaryView extends ConsumerWidget {
  const _SummaryView({required this.groupId});

  final String groupId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(sessionControllerProvider);
    final s = state.summary;

    return Scaffold(
      appBar: AppBar(title: const Text('Résumé'), automaticallyImplyLeading: false),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 16),
            const Center(child: Text('🎉', style: TextStyle(fontSize: 56))),
            const SizedBox(height: 8),
            const Center(
              child: Text('Belle exploration !',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            ),
            const SizedBox(height: 24),
            _SummaryRow('Distance', '${(s?.distanceKm ?? 0).toStringAsFixed(2)} km'),
            _SummaryRow('Pas', '${s?.steps ?? 0}'),
            _SummaryRow('Durée', SessionScreen._fmt(Duration(seconds: s?.durationS ?? 0))),
            _SummaryRow('Nouvelle zone révélée', '✅ ajoutée à la carte du groupe'),
            if (state.error != null) ...[
              const SizedBox(height: 12),
              Text(state.error!, style: const TextStyle(color: AppColors.danger)),
            ],
            if (FeatureFlags.photos && s != null) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                icon: const Icon(Icons.add_a_photo),
                label: const Text('Ajouter une photo souvenir'),
                onPressed: () async {
                  final picked = await ImagePicker().pickImage(
                    source: ImageSource.gallery,
                    maxWidth: 1600,
                    imageQuality: 85,
                  );
                  if (picked == null) return;
                  await ref.read(sessionRepositoryProvider).addPhoto(
                        sessionId: s.id,
                        groupId: s.groupId,
                        image: File(picked.path),
                      );
                  if (FeatureFlags.missions) {
                    await ref.read(economyRepositoryProvider).recordActivity('photo', 1);
                  }
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Photo ajoutée au souvenir 📷')),
                    );
                  }
                },
              ),
            ],
            const Spacer(),
            FilledButton(
              onPressed: () {
                ref.read(sessionControllerProvider.notifier).reset();
                context.go('/map/$groupId');
              },
              child: const Text('Retour à la carte'),
            ),
          ],
        ),
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AppColors.textSecondary)),
          Flexible(
            child: Text(value,
                textAlign: TextAlign.right,
                style: const TextStyle(fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }
}
