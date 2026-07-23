/// Un groupe privé (table `groups`).
class Group {
  const Group({
    required this.id,
    required this.name,
    required this.ownerId,
    required this.createdAt,
  });

  final String id;
  final String name;

  /// Administrateur du groupe (👑). Le premier utilisateur devient admin.
  final String ownerId;
  final DateTime createdAt;

  factory Group.fromMap(Map<String, dynamic> map) {
    return Group(
      id: map['id'] as String,
      name: map['name'] as String,
      ownerId: map['owner_id'] as String,
      createdAt: DateTime.parse(map['created_at'] as String),
    );
  }
}

/// Rôle d'un membre dans un groupe.
enum MemberRole { admin, member }

MemberRole memberRoleFromString(String value) =>
    value == 'admin' ? MemberRole.admin : MemberRole.member;

/// Appartenance d'un joueur à un groupe (table `group_members`).
class GroupMember {
  const GroupMember({
    required this.groupId,
    required this.userId,
    required this.role,
  });

  final String groupId;
  final String userId;
  final MemberRole role;

  bool get isAdmin => role == MemberRole.admin;

  factory GroupMember.fromMap(Map<String, dynamic> map) {
    return GroupMember(
      groupId: map['group_id'] as String,
      userId: map['user_id'] as String,
      role: memberRoleFromString(map['role'] as String),
    );
  }
}
