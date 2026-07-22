/// Profil de jeu d'un joueur (table `profiles`).
class Profile {
  const Profile({
    required this.id,
    required this.displayName,
    required this.avatarKey,
    required this.color,
  });

  final String id;
  final String displayName;
  final String avatarKey;

  /// Couleur du joueur au format hex `#RRGGBB` (tracés & avatar).
  final String color;

  factory Profile.fromMap(Map<String, dynamic> map) {
    return Profile(
      id: map['id'] as String,
      displayName: map['display_name'] as String,
      avatarKey: (map['avatar_key'] as String?) ?? 'default',
      color: (map['color'] as String?) ?? '#6EE7F0',
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'display_name': displayName,
        'avatar_key': avatarKey,
        'color': color,
      };
}
