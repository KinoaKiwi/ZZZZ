import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../data/repositories/economy_repository.dart';

/// Pastille affichant le solde de Djadja Coins du joueur (temps réel).
class CoinChip extends ConsumerWidget {
  const CoinChip({super.key, required this.groupId});

  final String groupId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final balance = ref.watch(walletBalanceProvider(groupId));
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.neonAmber.withOpacity(0.5)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('🪙', style: TextStyle(fontSize: 16)),
          const SizedBox(width: 6),
          Text(
            '${balance.valueOrNull ?? 0}',
            style: const TextStyle(
              color: AppColors.neonAmber,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}
