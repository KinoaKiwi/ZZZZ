import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/supabase/supabase_providers.dart';
import '../models/group.dart';

/// Gestion des groupes privés : création (admin), adhésion par lien, membres.
class GroupRepository {
  GroupRepository(this._client);

  final SupabaseClient _client;

  /// Crée un groupe ; le créateur devient administrateur (RPC serveur atomique).
  Future<Group> createGroup(String name) async {
    final data = await _client.rpc('create_group', params: {'p_name': name});
    return Group.fromMap(_firstRow(data));
  }

  /// Rejoint un groupe via un jeton de lien d'invitation (RPC serveur).
  Future<Group> joinWithToken(String token) async {
    final data = await _client.rpc('join_group_with_token', params: {'p_token': token});
    return Group.fromMap(_firstRow(data));
  }

  /// Groupes de l'utilisateur courant.
  Future<List<Group>> myGroups() async {
    final rows = await _client
        .from('groups')
        .select('id, name, owner_id, created_at')
        .order('created_at');
    return (rows as List).map((r) => Group.fromMap(r as Map<String, dynamic>)).toList();
  }

  /// Membres d'un groupe.
  Future<List<GroupMember>> members(String groupId) async {
    final rows = await _client
        .from('group_members')
        .select('group_id, user_id, role')
        .eq('group_id', groupId);
    return (rows as List).map((r) => GroupMember.fromMap(r as Map<String, dynamic>)).toList();
  }

  /// Crée un lien d'invitation et renvoie le deep link `gayeulle://join?token=…`.
  Future<String> createInviteLink(String groupId) async {
    final userId = _client.auth.currentUser!.id;
    final row = await _client
        .from('group_invites')
        .insert({'group_id': groupId, 'created_by': userId})
        .select('token')
        .single();
    final token = row['token'] as String;
    return 'gayeulle://join?token=$token';
  }

  /// Les RPC peuvent renvoyer une ligne unique ou une liste selon le driver.
  Map<String, dynamic> _firstRow(dynamic data) {
    if (data is List) return data.first as Map<String, dynamic>;
    return data as Map<String, dynamic>;
  }
}

final groupRepositoryProvider = Provider<GroupRepository>((ref) {
  return GroupRepository(ref.watch(supabaseClientProvider));
});

/// Liste des groupes de l'utilisateur (rafraîchie à la demande).
final myGroupsProvider = FutureProvider<List<Group>>((ref) {
  return ref.watch(groupRepositoryProvider).myGroups();
});
