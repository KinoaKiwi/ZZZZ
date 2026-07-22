import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_compass/flutter_compass.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';

import '../../core/location/location_service.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/geo_utils.dart';
import '../../data/models/contest_item.dart';
import '../../data/models/game_event.dart';
import '../../data/models/geo_point.dart';
import '../../data/repositories/contest_repository.dart';

/// Mode Boussole : navigation à la flèche (direction + distance), **sans carte**.
/// Disponible uniquement en événement (Contest Boussole ou expédition).
/// En Contest Boussole, on peut aussi utiliser des objets et récupérer des
/// tracés en passant dessus (récupération passive périodique).
class CompassScreen extends ConsumerStatefulWidget {
  const CompassScreen({super.key, required this.groupId, required this.eventId});

  final String groupId;
  final String eventId;

  @override
  ConsumerState<CompassScreen> createState() => _CompassScreenState();
}

class _CompassScreenState extends ConsumerState<CompassScreen> {
  final LocationService _location = LocationService();
  StreamSubscription<Position>? _posSub;
  StreamSubscription<CompassEvent>? _headingSub;

  GeoPoint? _current;
  double _heading = 0; // cap de l'appareil (degrés)
  final List<GeoPoint> _path = []; // pour la récupération passive (Contest)

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    if (!await _location.ensurePermission()) return;
    _posSub = _location.positionStream(distanceFilterM: 5).listen((pos) {
      setState(() => _current = GeoPoint(pos.latitude, pos.longitude));
      _path.add(GeoPoint(pos.latitude, pos.longitude));
      _maybeRecover();
    });
    _headingSub = FlutterCompass.events?.listen((e) {
      if (e.heading != null) setState(() => _heading = e.heading!);
    });
  }

  /// Récupération passive périodique (tous les ~20 points) en Contest Boussole.
  Future<void> _maybeRecover() async {
    final event = ref.read(eventByIdProvider(widget.eventId)).valueOrNull;
    if (event == null || event.kind != EventKind.contestCompass) return;
    if (_path.length < 20) return;
    final segment = GeoLine(List.of(_path));
    _path.clear();
    try {
      await ref.read(contestRepositoryProvider).passRecover(widget.eventId, segment);
    } catch (_) {/* confort, non bloquant */}
  }

  @override
  void dispose() {
    _posSub?.cancel();
    _headingSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final event = ref.watch(eventByIdProvider(widget.eventId));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Mode Boussole'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/map/${widget.groupId}'),
        ),
      ),
      body: event.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Erreur : $e')),
        data: (ev) => _compassBody(ev),
      ),
    );
  }

  Widget _compassBody(GameEvent event) {
    final target = event.target;
    final current = _current;

    double? bearing;
    double? distance;
    if (target != null && current != null) {
      bearing = GeoUtils.bearing(current, target);
      distance = Geolocator.distanceBetween(
          current.lat, current.lng, target.lat, target.lng);
    }

    // Angle de la flèche = direction vers la cible relative au cap de l'appareil.
    final arrowAngle =
        bearing == null ? 0.0 : ((bearing - _heading) * math.pi / 180.0);

    return Column(
      children: [
        const SizedBox(height: 24),
        Text(event.kind.label,
            style: const TextStyle(fontSize: 16, color: AppColors.textSecondary)),
        const Spacer(),
        if (target == null)
          const Padding(
            padding: EdgeInsets.all(24),
            child: Text('Aucune cible définie pour cet événement.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textSecondary)),
          )
        else
          Column(
            children: [
              Container(
                width: 240,
                height: 240,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.surface,
                  border: Border.all(color: AppColors.neonCyan.withOpacity(0.4), width: 2),
                ),
                child: Center(
                  child: Transform.rotate(
                    angle: arrowAngle,
                    child: const Icon(Icons.navigation,
                        size: 120, color: AppColors.neonCyan),
                  ),
                ),
              ),
              const SizedBox(height: 28),
              Text(
                distance == null
                    ? '— m'
                    : distance < 1000
                        ? '${distance.round()} m'
                        : '${(distance / 1000).toStringAsFixed(2)} km',
                style: const TextStyle(
                    fontSize: 34, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
              ),
              Text(
                bearing == null ? '' : 'cap ${bearing.round()}°',
                style: const TextStyle(color: AppColors.textFaint),
              ),
              if (distance != null && distance < 25) ...[
                const SizedBox(height: 8),
                const Text('🎯 Tu y es presque !',
                    style: TextStyle(color: AppColors.success, fontWeight: FontWeight.bold)),
              ],
            ],
          ),
        const Spacer(),
        if (event.kind.isContest) _contestActions(current),
        const SizedBox(height: 16),
      ],
    );
  }

  /// Barre d'objets Contest : agissent à la position actuelle du joueur.
  Widget _contestActions(GeoPoint? current) {
    final items = ref.watch(contestItemsProvider(widget.groupId)).valueOrNull ?? [];
    final usable = items.where((i) => i.quantity > 0).toList();
    if (usable.isEmpty || current == null) {
      return const Text('Récupération active en passant sur les tracés adverses 🖌️',
          style: TextStyle(color: AppColors.textFaint, fontSize: 12));
    }
    return Wrap(
      spacing: 10,
      children: [
        for (final item in usable)
          _ItemButton(
            item: item,
            onTap: () => _useItem(item, current),
          ),
      ],
    );
  }

  Future<void> _useItem(ContestItem item, GeoPoint at) async {
    try {
      await ref.read(contestRepositoryProvider).useItem(
            eventId: widget.eventId,
            code: item.code,
            at: at,
          );
      ref.invalidate(contestItemsProvider(widget.groupId));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${item.emoji} ${item.name} utilisé ici')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }
}

class _ItemButton extends StatelessWidget {
  const _ItemButton({required this.item, required this.onTap});

  final ContestItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onTap,
      child: Text('${item.emoji} ×${item.quantity}'),
    );
  }
}
