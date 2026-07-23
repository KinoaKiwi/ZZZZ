import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../data/models/presence.dart';
import '../../../data/repositories/presence_repository.dart';

/// Réglage de visibilité de sa position pour le groupe :
/// visible · visible uniquement pendant session · invisible.
class VisibilitySheet extends ConsumerWidget {
  const VisibilitySheet({super.key, required this.groupId});

  final String groupId;

  static Future<void> show(BuildContext context, {required String groupId}) {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (_) => VisibilitySheet(groupId: groupId),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = ref.watch(_myVisibilityProvider(groupId));

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Ma visibilité sur la carte',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            const SizedBox(height: 8),
            current.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Text('Erreur : $e'),
              data: (visibility) => Column(
                children: [
                  _option(
                    context, ref,
                    value: PresenceVisibility.visible,
                    selected: visibility,
                    emoji: '👁️',
                    title: 'Visible',
                    subtitle: 'Les amis voient ma position en permanence',
                  ),
                  _option(
                    context, ref,
                    value: PresenceVisibility.sessionOnly,
                    selected: visibility,
                    emoji: '🚶',
                    title: 'Pendant mes sessions',
                    subtitle: 'Visible uniquement quand j\'explore',
                  ),
                  _option(
                    context, ref,
                    value: PresenceVisibility.invisible,
                    selected: visibility,
                    emoji: '🕶️',
                    title: 'Invisible',
                    subtitle: 'Personne ne voit ma position',
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _option(
    BuildContext context,
    WidgetRef ref, {
    required PresenceVisibility value,
    required PresenceVisibility selected,
    required String emoji,
    required String title,
    required String subtitle,
  }) {
    final isSelected = value == selected;
    return ListTile(
      leading: Text(emoji, style: const TextStyle(fontSize: 22)),
      title: Text(title),
      subtitle: Text(subtitle, style: const TextStyle(fontSize: 12)),
      trailing: isSelected
          ? const Icon(Icons.check_circle, color: AppColors.neonCyan)
          : null,
      onTap: () async {
        await ref
            .read(presenceRepositoryProvider)
            .setVisibility(groupId, value);
        ref.invalidate(_myVisibilityProvider(groupId));
        if (context.mounted) Navigator.pop(context);
      },
    );
  }
}

final _myVisibilityProvider =
    FutureProvider.family<PresenceVisibility, String>((ref, groupId) {
  return ref.watch(presenceRepositoryProvider).myVisibility(groupId);
});
