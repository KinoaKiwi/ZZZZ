/// Catégorie d'objet de boutique (100 % cosmétique).
enum ItemCategory { avatarSkin, clothing, companion, camp, map, trail, effect }

ItemCategory itemCategoryFromString(String value) {
  switch (value) {
    case 'avatar_skin':
      return ItemCategory.avatarSkin;
    case 'clothing':
      return ItemCategory.clothing;
    case 'companion':
      return ItemCategory.companion;
    case 'camp':
      return ItemCategory.camp;
    case 'map':
      return ItemCategory.map;
    case 'trail':
      return ItemCategory.trail;
    default:
      return ItemCategory.effect;
  }
}

extension ItemCategoryLabel on ItemCategory {
  String get label {
    switch (this) {
      case ItemCategory.avatarSkin:
        return 'Avatars';
      case ItemCategory.clothing:
        return 'Vêtements';
      case ItemCategory.companion:
        return 'Compagnons';
      case ItemCategory.camp:
        return 'Camps';
      case ItemCategory.map:
        return 'Cartes';
      case ItemCategory.trail:
        return 'Tracés';
      case ItemCategory.effect:
        return 'Effets';
    }
  }

  String get emoji {
    switch (this) {
      case ItemCategory.avatarSkin:
        return '🧑‍🚀';
      case ItemCategory.clothing:
        return '🧥';
      case ItemCategory.companion:
        return '🦊';
      case ItemCategory.camp:
        return '🏕️';
      case ItemCategory.map:
        return '🗺️';
      case ItemCategory.trail:
        return '🌈';
      case ItemCategory.effect:
        return '✨';
    }
  }
}

/// Un article de la boutique (table `shop_items`).
class ShopItem {
  const ShopItem({
    required this.id,
    required this.category,
    required this.name,
    required this.price,
    this.owned = false,
  });

  final String id;
  final ItemCategory category;
  final String name;
  final int price;

  /// Renseigné côté app en croisant avec l'inventaire du joueur.
  final bool owned;

  factory ShopItem.fromMap(Map<String, dynamic> map, {bool owned = false}) {
    return ShopItem(
      id: map['id'] as String,
      category: itemCategoryFromString(map['category'] as String),
      name: map['name'] as String,
      price: (map['price'] as num).toInt(),
      owned: owned,
    );
  }

  ShopItem copyWith({bool? owned}) => ShopItem(
        id: id,
        category: category,
        name: name,
        price: price,
        owned: owned ?? this.owned,
      );
}
