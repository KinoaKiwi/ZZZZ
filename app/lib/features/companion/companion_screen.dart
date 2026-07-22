import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/location/location_service.dart';
import '../../core/theme/app_colors.dart';
import '../../data/models/companion.dart';
import '../../data/models/geo_point.dart';
import '../../data/repositories/companion_repository.dart';

/// Le compagnon : vit sur la carte, possède une niche, explore une fois par
/// jour (révèle ~100 m) puis revient dormir.
class CompanionScreen extends ConsumerStatefulWidget {
  const CompanionScreen({super.key, required this.groupId});

  final String groupId;

  @override
  ConsumerState<CompanionScreen> createState() => _CompanionScreenState();
}

class _CompanionScreenState extends ConsumerState<CompanionScreen> {
  bool _busy = false;
  bool? _ranToday;

  Future<void> _adopt() async {
    setState(() => _busy = true);
    try {
      // La niche est posée à la position actuelle du joueur.
      final location = LocationService();
      if (!await location.ensurePermission()) {
        throw 'Localisation requise pour poser la niche.';
      }
      final pos = await location.currentPosition();
      await ref.read(companionRepositoryProvider).adopt(
            groupId: widget.groupId,
            den: GeoPoint(pos.latitude, pos.longitude),
          );
      ref.invalidate(companionProvider(widget.groupId));
    } catch (e) {
      _snack('$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendExploring(Companion companion) async {
    setState(() => _busy = true);
    try {
      await ref.read(companionRepositoryProvider).sendExploring(widget.groupId);
      setState(() => _ranToday = true);
      _snack('Ton compagnon explore une zone inconnue et révèle ~100 m 🐾 (+🪙 25)');
    } catch (e) {
      _snack('$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _snack(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final companion = ref.watch(companionProvider(widget.groupId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Mon compagnon'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/map/${widget.groupId}'),
        ),
      ),
      body: companion.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Erreur : $e')),
        data: (c) => c == null ? _adoptView() : _companionView(c),
      ),
    );
  }

  Widget _adoptView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('🐾', style: TextStyle(fontSize: 72)),
            const SizedBox(height: 16),
            const Text('Adopte un compagnon',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text(
              'Il vivra sur la carte, aura sa niche ici, et partira explorer '
              'une zone inconnue une fois par jour.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _busy ? null : _adopt,
              icon: const Icon(Icons.pets),
              label: const Text('Poser la niche ici'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _companionView(Companion c) {
    final ranToday = _ranToday;
    return FutureBuilder<bool>(
      future: ranToday != null
          ? Future.value(ranToday)
          : ref.read(companionRepositoryProvider).hasRunToday(c.id),
      builder: (context, snap) {
        final hasRun = snap.data ?? false;
        return Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const SizedBox(height: 12),
              const Text('🦊', style: TextStyle(fontSize: 84)),
              const SizedBox(height: 12),
              Text('Compagnon (${c.species})',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text(
                c.hasDen
                    ? '🏠 Niche : ${c.den!.lat.toStringAsFixed(4)}, ${c.den!.lng.toStringAsFixed(4)}'
                    : 'Pas encore de niche',
                style: const TextStyle(color: AppColors.textSecondary),
              ),
              const Spacer(),
              if (hasRun)
                const Card(
                  child: Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('😴 Ton compagnon a déjà exploré aujourd\'hui.\n'
                        'Reviens demain pour une nouvelle sortie.',
                        textAlign: TextAlign.center),
                  ),
                )
              else
                FilledButton.icon(
                  onPressed: _busy ? null : () => _sendExploring(c),
                  icon: const Icon(Icons.explore),
                  label: const Text('Envoyer explorer (1×/jour)'),
                ),
              const SizedBox(height: 12),
            ],
          ),
        );
      },
    );
  }
}
