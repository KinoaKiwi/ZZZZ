import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/theme/app_colors.dart';
import '../../data/models/geo_point.dart';
import '../../data/models/poi.dart';
import '../../data/repositories/poi_repository.dart';

/// Fiche de création d'un point d'intérêt (photo / lieu / souvenir) à une
/// position donnée — ouverte depuis un appui long sur la carte.
class AddPoiSheet extends ConsumerStatefulWidget {
  const AddPoiSheet({super.key, required this.groupId, required this.position});

  final String groupId;
  final GeoPoint position;

  /// Ouvre la fiche. Retourne `true` si un POI a été créé.
  static Future<bool?> show(
    BuildContext context, {
    required String groupId,
    required GeoPoint position,
  }) {
    return showModalBottomSheet<bool>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      builder: (_) => AddPoiSheet(groupId: groupId, position: position),
    );
  }

  @override
  ConsumerState<AddPoiSheet> createState() => _AddPoiSheetState();
}

class _AddPoiSheetState extends ConsumerState<AddPoiSheet> {
  final _titleCtrl = TextEditingController();
  PoiKind _kind = PoiKind.place;
  final List<File> _images = [];
  bool _busy = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage(ImageSource source) async {
    final picked = await ImagePicker().pickImage(
      source: source,
      maxWidth: 1600,
      imageQuality: 85,
    );
    if (picked != null) {
      setState(() {
        _images.add(File(picked.path));
        if (_kind == PoiKind.place) _kind = PoiKind.photo;
      });
    }
  }

  Future<void> _save() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await ref.read(poiRepositoryProvider).create(
            groupId: widget.groupId,
            kind: _kind,
            position: widget.position,
            title: _titleCtrl.text.trim().isEmpty ? null : _titleCtrl.text.trim(),
            images: _images,
          );
      ref.invalidate(poisProvider(widget.groupId));
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur : $e')),
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
            'Nouveau souvenir 📌',
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
          ),
          const SizedBox(height: 4),
          Text(
            '${widget.position.lat.toStringAsFixed(5)}, '
            '${widget.position.lng.toStringAsFixed(5)}',
            style: const TextStyle(color: AppColors.textFaint, fontSize: 12),
          ),
          const SizedBox(height: 12),
          SegmentedButton<PoiKind>(
            segments: const [
              ButtonSegment(value: PoiKind.place, label: Text('Lieu'), icon: Text('📍')),
              ButtonSegment(value: PoiKind.photo, label: Text('Photo'), icon: Text('📷')),
              ButtonSegment(value: PoiKind.memory, label: Text('Souvenir'), icon: Text('💭')),
            ],
            selected: {_kind},
            onSelectionChanged: (s) => setState(() => _kind = s.first),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _titleCtrl,
            decoration: const InputDecoration(hintText: 'Titre (optionnel)'),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              OutlinedButton.icon(
                icon: const Icon(Icons.photo_camera),
                label: const Text('Caméra'),
                onPressed: () => _pickImage(ImageSource.camera),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                icon: const Icon(Icons.photo_library),
                label: const Text('Galerie'),
                onPressed: () => _pickImage(ImageSource.gallery),
              ),
              const Spacer(),
              if (_images.isNotEmpty)
                Text('${_images.length} 🖼️',
                    style: const TextStyle(color: AppColors.textSecondary)),
            ],
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: _busy
                ? const SizedBox(
                    height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Épingler sur la carte'),
          ),
        ],
      ),
    );
  }
}
