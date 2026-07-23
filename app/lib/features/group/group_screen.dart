import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../data/repositories/auth_repository.dart';
import '../../data/repositories/group_repository.dart';

/// Écran des groupes privés : liste, création (👑 admin), adhésion par lien.
///
/// Si [inviteToken] est fourni (via un deep link `gayeulle://join?token=…`),
/// l'adhésion au groupe est tentée automatiquement au premier affichage.
class GroupScreen extends ConsumerStatefulWidget {
  const GroupScreen({super.key, this.inviteToken});

  final String? inviteToken;

  @override
  ConsumerState<GroupScreen> createState() => _GroupScreenState();
}

class _GroupScreenState extends ConsumerState<GroupScreen> {
  @override
  void initState() {
    super.initState();
    final token = widget.inviteToken;
    if (token != null && token.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _autoJoin(token));
    }
  }

  Future<void> _autoJoin(String token) async {
    try {
      final group = await ref.read(groupRepositoryProvider).joinWithToken(token);
      ref.invalidate(myGroupsProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Tu as rejoint « ${group.name} » 🎉')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Lien d\'invitation invalide : $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final ref = this.ref;
    final groups = ref.watch(myGroupsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Mes groupes'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authRepositoryProvider).signOut(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showCreateOrJoin(context, ref),
        backgroundColor: AppColors.neonCyan,
        foregroundColor: AppColors.background,
        icon: const Icon(Icons.add),
        label: const Text('Groupe'),
      ),
      body: groups.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Erreur : $e')),
        data: (list) {
          if (list.isEmpty) {
            return const _EmptyGroups();
          }
          return ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: list.length,
            itemBuilder: (context, i) {
              final g = list[i];
              return Card(
                child: ListTile(
                  leading: const CircleAvatar(child: Text('🗺️')),
                  title: Text(g.name),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: const Icon(Icons.person_add, color: AppColors.neonCyan),
                        tooltip: 'Inviter des amis',
                        onPressed: () => _showInvite(context, ref, g.id),
                      ),
                      const Icon(Icons.chevron_right),
                    ],
                  ),
                  onTap: () => context.go('/map/${g.id}'),
                ),
              );
            },
          );
        },
      ),
    );
  }

  /// Génère un lien/jeton d'invitation et l'affiche pour le partager aux amis.
  Future<void> _showInvite(BuildContext context, WidgetRef ref, String groupId) async {
    String? link;
    String? errorMsg;
    try {
      link = await ref.read(groupRepositoryProvider).createInviteLink(groupId);
    } catch (e) {
      errorMsg = e.toString();
    }
    if (!context.mounted) return;

    // Le jeton est la partie après "token=".
    final token = link != null && link.contains('token=')
        ? link.split('token=').last
        : null;

    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Inviter des amis'),
        content: errorMsg != null
            ? Text('Erreur : $errorMsg')
            : Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Tes amis installent l\'app, créent un compte, puis collent '
                    'ce code dans « Rejoindre via un lien » :',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
                  ),
                  const SizedBox(height: 12),
                  SelectableText(
                    token ?? link ?? '',
                    style: const TextStyle(
                      color: AppColors.neonCyan,
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                ],
              ),
        actions: [
          if (token != null || link != null)
            TextButton.icon(
              icon: const Icon(Icons.copy),
              label: const Text('Copier le code'),
              onPressed: () => copyInvite(ctx, token ?? link!),
            ),
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Fermer'),
          ),
        ],
      ),
    );
  }

  Future<void> _showCreateOrJoin(BuildContext context, WidgetRef ref) async {
    final nameCtrl = TextEditingController();
    final tokenCtrl = TextEditingController();

    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 20, right: 20, top: 20,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Créer un groupe', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            TextField(controller: nameCtrl, decoration: const InputDecoration(hintText: 'Nom du groupe')),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () async {
                await ref.read(groupRepositoryProvider).createGroup(nameCtrl.text.trim());
                ref.invalidate(myGroupsProvider);
                if (ctx.mounted) Navigator.pop(ctx);
              },
              child: const Text('Créer (je deviens admin 👑)'),
            ),
            const Divider(height: 32),
            const Text('Rejoindre via un lien', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            TextField(controller: tokenCtrl, decoration: const InputDecoration(hintText: 'Jeton d\'invitation')),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: () async {
                await ref.read(groupRepositoryProvider).joinWithToken(tokenCtrl.text.trim());
                ref.invalidate(myGroupsProvider);
                if (ctx.mounted) Navigator.pop(ctx);
              },
              child: const Text('Rejoindre'),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyGroups extends StatelessWidget {
  const _EmptyGroups();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('👑', style: TextStyle(fontSize: 56)),
            SizedBox(height: 12),
            Text(
              'Aucun groupe pour l\'instant.\nCrée le tien (tu en seras l\'admin)\nou rejoins celui d\'un ami via son lien.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textSecondary),
            ),
          ],
        ),
      ),
    );
  }
}

/// Petit utilitaire pour copier un lien d'invitation dans le presse-papier.
Future<void> copyInvite(BuildContext context, String link) async {
  await Clipboard.setData(ClipboardData(text: link));
  if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Lien d\'invitation copié')),
    );
  }
}
