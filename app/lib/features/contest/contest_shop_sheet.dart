import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_colors.dart';
import '../../data/models/contest_item.dart';
import '../../data/repositories/contest_repository.dart';
import '../../data/repositories/economy_repository.dart';
import '../economy/widgets/coin_chip.dart';

/// Achat des objets Contest (bombe, pinceau, rouleau, bouclier) en Djadja Coins.
/// Volontairement chers pour préserver l'équilibre — et gagnés en jouant.
class ContestShopSheet extends ConsumerWidget {
  const ContestShopSheet({super.key, required this.groupId});

  final String groupId;

  static Future<void> show(BuildContext context, {required String groupId}) {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      builder: (_) => ContestShopSheet(groupId: groupId),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(contestItemsProvider(groupId));
    final balance = ref.watch(walletBalanceProvider(groupId)).valueOrNull ?? 0;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Text('Objets Contest',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                const Spacer(),
                CoinChip(groupId: groupId),
              ],
            ),
            const SizedBox(height: 12),
            items.when(
              loading: () => const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (e, _) => Text('Erreur : $e'),
              data: (list) => Column(
                children: [
                  for (final item in list)
                    _ItemRow(item: item, groupId: groupId, balance: balance),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ItemRow extends ConsumerStatefulWidget {
  const _ItemRow({required this.item, required this.groupId, required this.balance});

  final ContestItem item;
  final String groupId;
  final int balance;

  @override
  ConsumerState<_ItemRow> createState() => _ItemRowState();
}

class _ItemRowState extends ConsumerState<_ItemRow> {
  bool _busy = false;

  Future<void> _buy() async {
    setState(() => _busy = true);
    try {
      await ref.read(contestRepositoryProvider).buy(widget.groupId, widget.item.code, 1);
      ref.invalidate(contestItemsProvider(widget.groupId));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Achat impossible : $e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final affordable = widget.balance >= item.price;

    return Card(
      child: ListTile(
        leading: Text(item.emoji, style: const TextStyle(fontSize: 28)),
        title: Row(
          children: [
            Text(item.name),
            if (item.quantity > 0) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                decoration: BoxDecoration(
                  color: AppColors.surfaceHigh,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text('×${item.quantity}',
                    style: const TextStyle(fontSize: 12, color: AppColors.neonCyan)),
              ),
            ],
          ],
        ),
        subtitle: Text(item.description, style: const TextStyle(fontSize: 12)),
        trailing: SizedBox(
          height: 34,
          child: FilledButton(
            onPressed: (_busy || !affordable) ? null : _buy,
            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 12)),
            child: _busy
                ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : Text('🪙 ${item.price}'),
          ),
        ),
      ),
    );
  }
}
