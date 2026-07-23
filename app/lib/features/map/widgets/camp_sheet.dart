import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../data/models/geo_point.dart';
import '../../../data/repositories/camp_repository.dart';

/// Fiche de création d'un campement à une position donnée.
///
/// - Camp de groupe 🏕️ : réservé à l'admin (rendez-vous, expéditions) — le RLS
///   refuse l'écriture si l'utilisateur n'est pas admin.
/// - Camp personnel 🐾 : la niche du compagnon (une par joueur et par groupe).
class CampSheet extends ConsumerStatefulWidget {
  const CampSheet({super.key, required this.groupId, required this.position});

  final String groupId;
  final GeoPoint position;

  /// Ouvre la fiche. Retourne `true` si un camp a été créé.
  static Future<bool?> show(
    BuildContext context, {
    required String groupId,
    required GeoPoint position,
  }) {
    return showModalBottomSheet<bool>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      builder: (_) => CampSheet(groupId: groupId, position: position),
    );
  }

  @override
  ConsumerState<CampSheet> createState() => _CampSheetState();
}

class _CampSheetState extends ConsumerState<CampSheet> {
  final _nameCtrl = TextEditingController();
  bool _isGroupCamp = false;
  bool _busy = false;

  @override
  void dispose() {
    _nameCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty || _busy) return;
    setState(() => _busy = true);
    try {
      final repo = ref.read(campRepositoryProvider);
      if (_isGroupCamp) {
        await repo.createGroupCamp(
          groupId: widget.groupId,
          name: name,
          position: widget.position,
        );
      } else {
        await repo.upsertPersonalCamp(
          groupId: widget.groupId,
          name: name,
          position: widget.position,
        );
      }
      ref.invalidate(campsProvider(widget.groupId));
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _isGroupCamp
                  ? 'Seul l\'admin 👑 peut créer un camp de groupe. ($e)'
                  : 'Erreur : $e',
            ),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Nouveau campement 🏕️',
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _nameCtrl,
            decoration: const InputDecoration(hintText: 'Nom du camp'),
          ),
          const SizedBox(height: 8),
          SwitchListTile(
            value: _isGroupCamp,
            onChanged: (v) => setState(() => _isGroupCamp = v),
            title: const Text('Camp de groupe'),
            subtitle: const Text(
              'Rendez-vous & expéditions — réservé à l\'admin 👑.\n'
              'Sinon : camp personnel (la niche de ton compagnon).',
              style: TextStyle(fontSize: 12),
            ),
            activeColor: AppColors.neonLime,
          ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: _busy
                ? const SizedBox(
                    height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Planter le camp'),
          ),
        ],
      ),
    );
  }
}
