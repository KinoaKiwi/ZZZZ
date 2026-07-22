import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/supabase/supabase_providers.dart';
import '../models/shop_item.dart';

/// Boutique cosmétique : catalogue, inventaire, achats (débit serveur).
class ShopRepository {
  ShopRepository(this._client);

  final SupabaseClient _client;

  /// Catalogue actif, marqué « possédé » selon l'inventaire du joueur.
  Future<List<ShopItem>> catalogue() async {
    final userId = _client.auth.currentUser!.id;

    final items = await _client
        .from('shop_items')
        .select('id, category, name, price')
        .eq('active', true)
        .order('category');

    final owned = await _client
        .from('inventory')
        .select('item_id')
        .eq('user_id', userId);
    final ownedIds =
        (owned as List).map((r) => (r as Map)['item_id'] as String).toSet();

    return (items as List)
        .map((r) => ShopItem.fromMap(
              r as Map<String, dynamic>,
              owned: ownedIds.contains((r)['id']),
            ))
        .toList();
  }

  /// Achète un article (débit atomique + ajout à l'inventaire, RPC serveur).
  Future<void> purchase(String itemId, String groupId) {
    return _client.rpc('purchase_item', params: {
      'p_item_id': itemId,
      'p_group_id': groupId,
    });
  }
}

final shopRepositoryProvider = Provider<ShopRepository>((ref) {
  return ShopRepository(ref.watch(supabaseClientProvider));
});

/// Catalogue de la boutique (rafraîchi après achat via invalidate).
final shopCatalogueProvider = FutureProvider<List<ShopItem>>((ref) {
  return ref.watch(shopRepositoryProvider).catalogue();
});
