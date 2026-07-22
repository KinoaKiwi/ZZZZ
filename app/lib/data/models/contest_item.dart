/// Un objet de Contest (bombe, pinceau, rouleau, bouclier) avec le stock du
/// joueur (table `contest_items` + `contest_inventory`).
class ContestItem {
  const ContestItem({
    required this.code,
    required this.name,
    required this.price,
    required this.description,
    this.quantity = 0,
  });

  final String code;
  final String name;
  final int price;
  final String description;

  /// Quantité possédée par le joueur (renseignée côté app).
  final int quantity;

  String get emoji {
    switch (code) {
      case 'bomb':
        return '💣';
      case 'brush':
        return '🖌️';
      case 'roller':
        return '🧻';
      case 'shield':
        return '🛡️';
      default:
        return '❓';
    }
  }

  factory ContestItem.fromMap(Map<String, dynamic> map, {int quantity = 0}) {
    return ContestItem(
      code: map['code'] as String,
      name: map['name'] as String,
      price: (map['price'] as num).toInt(),
      description: (map['description'] as String?) ?? '',
      quantity: quantity,
    );
  }

  ContestItem copyWith({int? quantity}) => ContestItem(
        code: code,
        name: name,
        price: price,
        description: description,
        quantity: quantity ?? this.quantity,
      );
}
