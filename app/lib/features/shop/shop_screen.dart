import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../data/models/shop_item.dart';
import '../../data/repositories/economy_repository.dart';
import '../../data/repositories/shop_repository.dart';
import '../economy/widgets/coin_chip.dart';

/// Boutique cosmétique (aucun pay-to-win) : skins, vêtements, compagnons,
/// camps, cartes, tracés, effets — payés en Djadja Coins.
class ShopScreen extends ConsumerWidget {
  const ShopScreen({super.key, required this.groupId});

  final String groupId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final catalogue = ref.watch(shopCatalogueProvider);
    final balance = ref.watch(walletBalanceProvider(groupId)).valueOrNull ?? 0;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Boutique'),
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
      body: catalogue.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Erreur : $e')),
        data: (items) {
          final byCategory = <ItemCategory, List<ShopItem>>{};
          for (final item in items) {
            byCategory.putIfAbsent(item.category, () => []).add(item);
          }
          return ListView(
            padding: const EdgeInsets.all(12),
            children: [
              const Padding(
                padding: EdgeInsets.only(bottom: 8, left: 4),
                child: Text('100 % cosmétique — aucun avantage de jeu ne s\'achète.',
                    style: TextStyle(color: AppColors.textFaint, fontSize: 12)),
              ),
              for (final entry in byCategory.entries) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 12, 4, 6),
                  child: Text('${entry.key.emoji}  ${entry.key.label}',
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                ),
                for (final item in entry.value)
                  _ShopRow(item: item, groupId: groupId, balance: balance),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _ShopRow extends ConsumerStatefulWidget {
  const _ShopRow({required this.item, required this.groupId, required this.balance});

  final ShopItem item;
  final String groupId;
  final int balance;

  @override
  ConsumerState<_ShopRow> createState() => _ShopRowState();
}

class _ShopRowState extends ConsumerState<_ShopRow> {
  bool _busy = false;

  Future<void> _buy() async {
    setState(() => _busy = true);
    try {
      await ref.read(shopRepositoryProvider).purchase(widget.item.id, widget.groupId);
      ref.invalidate(shopCatalogueProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('« ${widget.item.name} » débloqué ✨')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Achat impossible : $e')),
        );
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
        leading: Text(item.category.emoji, style: const TextStyle(fontSize: 26)),
        title: Text(item.name),
        subtitle: Text('🪙 ${item.price}',
            style: const TextStyle(color: AppColors.neonAmber)),
        trailing: item.owned
            ? const Chip(
                label: Text('Possédé'),
                backgroundColor: AppColors.surfaceHigh,
                labelStyle: TextStyle(color: AppColors.success),
              )
            : SizedBox(
                height: 34,
                child: FilledButton(
                  onPressed: (_busy || !affordable) ? null : _buy,
                  child: _busy
                      ? const SizedBox(
                          height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : Text(affordable ? 'Acheter' : 'Trop cher'),
                ),
              ),
      ),
    );
  }
}
