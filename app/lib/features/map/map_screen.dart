import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../../core/config/env.dart';
import '../../core/config/feature_flags.dart';
import '../../core/supabase/supabase_providers.dart';
import '../../core/theme/app_colors.dart';
import '../../data/models/geo_point.dart';
import '../../data/models/presence.dart';
import '../../data/repositories/camp_repository.dart';
import '../../data/repositories/map_repository.dart';
import '../../data/repositories/poi_repository.dart';
import '../../data/repositories/group_repository.dart';
import '../../data/repositories/presence_repository.dart';
import '../places/add_poi_sheet.dart';
import 'widgets/camp_sheet.dart';
import 'widgets/visibility_sheet.dart';

/// Carte commune du groupe : brouillard d'exploration percé par les zones
/// découvertes, tracés colorés, amis en direct, lieux/souvenirs et campements.
class MapScreen extends ConsumerStatefulWidget {
  const MapScreen({super.key, required this.groupId});

  final String groupId;

  @override
  ConsumerState<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends ConsumerState<MapScreen> {
  MaplibreMapController? _controller;
  bool _styleReady = false;

  static const _zonesSource = 'discovered-zones';
  static const _tracksSourcePrefix = 'track-';
  static const _poisSource = 'pois';
  static const _campsSource = 'camps';
  static const _friendsSource = 'friends';

  @override
  Widget build(BuildContext context) {
    // Recharge les couches vivantes quand les données changent.
    if (FeatureFlags.realtime) {
      ref.watch(groupProfilesProvider(widget.groupId)); // couleurs des amis
      ref.listen(groupPresenceProvider(widget.groupId), (_, next) {
        final list = next.valueOrNull;
        if (list != null) _drawFriends(list);
      });
      // Nouvelle zone découverte par un ami → recharge zones + tracés.
      ref.listen(zonesLiveProvider(widget.groupId), (prev, next) {
        if (prev?.valueOrNull != next.valueOrNull) _reloadLayers();
      });
    }

    return Scaffold(
      body: Stack(
        children: [
          MaplibreMap(
            styleString: Env.mapStyleUrl,
            myLocationEnabled: true,
            initialCameraPosition: const CameraPosition(
              target: LatLng(48.8566, 2.3522), // recentré sur la position au 1er fix
              zoom: 15,
            ),
            onMapCreated: (c) => _controller = c,
            onStyleLoadedCallback: _onStyleLoaded,
            onMapLongClick: (_, latLng) => _onLongPress(latLng),
          ),
          // Voile de brouillard global (percé visuellement par les zones claires).
          IgnorePointer(
            child: Container(color: AppColors.fog.withOpacity(0.15)),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                children: [
                  _RoundButton(
                    icon: Icons.arrow_back,
                    onTap: () => context.go('/groups'),
                  ),
                  const Spacer(),
                  if (FeatureFlags.realtime)
                    _RoundButton(
                      icon: Icons.visibility,
                      onTap: () => VisibilitySheet.show(context, groupId: widget.groupId),
                    ),
                  const SizedBox(width: 8),
                  if (FeatureFlags.chat)
                    _RoundButton(
                      icon: Icons.chat_bubble_outline,
                      onTap: () => context.go('/chat/${widget.groupId}'),
                    ),
                  const SizedBox(width: 8),
                  _RoundButton(icon: Icons.refresh, onTap: _reloadLayers),
                ],
              ),
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.go('/session/${widget.groupId}'),
        backgroundColor: AppColors.neonMagenta,
        foregroundColor: AppColors.background,
        icon: const Icon(Icons.directions_walk),
        label: const Text('Commencer une session'),
      ),
    );
  }

  Future<void> _onStyleLoaded() async {
    _styleReady = true;
    await _reloadLayers();
  }

  /// Appui long : ajouter un lieu/souvenir ou un campement à cet endroit.
  Future<void> _onLongPress(LatLng latLng) async {
    final position = GeoPoint(latLng.latitude, latLng.longitude);
    final action = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (FeatureFlags.photos)
              ListTile(
                leading: const Text('📌', style: TextStyle(fontSize: 22)),
                title: const Text('Ajouter un lieu / souvenir'),
                onTap: () => Navigator.pop(ctx, 'poi'),
              ),
            if (FeatureFlags.camps)
              ListTile(
                leading: const Text('🏕️', style: TextStyle(fontSize: 22)),
                title: const Text('Placer un campement'),
                onTap: () => Navigator.pop(ctx, 'camp'),
              ),
          ],
        ),
      ),
    );
    if (!mounted) return;

    var changed = false;
    if (action == 'poi') {
      changed = await AddPoiSheet.show(
            context,
            groupId: widget.groupId,
            position: position,
          ) ??
          false;
    } else if (action == 'camp') {
      changed = await CampSheet.show(
            context,
            groupId: widget.groupId,
            position: position,
          ) ??
          false;
    }
    if (changed) await _reloadLayers();
  }

  // ───────────────────────────── couches carte ─────────────────────────────

  /// (Re)charge toutes les couches depuis Supabase.
  Future<void> _reloadLayers() async {
    if (!_styleReady) return;
    final controller = _controller;
    if (controller == null) return;
    final repo = ref.read(mapRepositoryProvider);

    // --- Zones découvertes (révélation du brouillard) ---
    final zones = await repo.discoveredZonesFeatureCollection(widget.groupId);
    await _resetSource(_zonesSource, zones);
    await controller.addFillLayer(
      _zonesSource,
      '$_zonesSource-fill',
      const FillLayerProperties(fillColor: '#1E2634', fillOpacity: 0.85),
    );

    // --- Tracés colorés par propriétaire ---
    final tracks = await repo.tracks(widget.groupId);
    for (final track in tracks) {
      final srcId = '$_tracksSourcePrefix${track.id}';
      await _resetSource(srcId, {
        'type': 'Feature',
        'geometry': track.line.toGeoJson(),
        'properties': {'owner': track.userId},
      });
      await controller.addLineLayer(
        srcId,
        '$srcId-line',
        LineLayerProperties(
          lineColor: track.color,
          lineWidth: 4,
          lineCap: 'round',
          lineJoin: 'round',
        ),
      );
    }

    // --- Lieux / souvenirs (Phase 2) ---
    if (FeatureFlags.photos) {
      final pois = await ref.read(poiRepositoryProvider).list(widget.groupId);
      await _resetSource(_poisSource, {
        'type': 'FeatureCollection',
        'features': [
          for (final poi in pois)
            {
              'type': 'Feature',
              'geometry': {
                'type': 'Point',
                'coordinates': poi.position.toGeoJsonCoords(),
              },
              'properties': {'title': poi.title ?? '', 'kind': poi.kind.name},
            },
        ],
      });
      await controller.addCircleLayer(
        _poisSource,
        '$_poisSource-circles',
        const CircleLayerProperties(
          circleRadius: 7,
          circleColor: '#F0C86E',
          circleStrokeWidth: 2,
          circleStrokeColor: '#0B0E14',
        ),
      );
    }

    // --- Campements (Phase 2) ---
    if (FeatureFlags.camps) {
      final camps = await ref.read(campRepositoryProvider).list(widget.groupId);
      await _resetSource(_campsSource, {
        'type': 'FeatureCollection',
        'features': [
          for (final camp in camps)
            {
              'type': 'Feature',
              'geometry': {
                'type': 'Point',
                'coordinates': camp.position.toGeoJsonCoords(),
              },
              'properties': {'name': camp.name, 'kind': camp.kind.name},
            },
        ],
      });
      await controller.addCircleLayer(
        _campsSource,
        '$_campsSource-circles',
        const CircleLayerProperties(
          circleRadius: 9,
          circleColor: '#A6F06E',
          circleStrokeWidth: 2,
          circleStrokeColor: '#0B0E14',
        ),
      );
    }

    // --- Amis en direct (Phase 2) ---
    if (FeatureFlags.realtime) {
      final presence = ref.read(groupPresenceProvider(widget.groupId)).valueOrNull;
      if (presence != null) await _drawFriends(presence);
    }
  }

  /// Dessine les positions live des amis (hors soi-même, fraîches uniquement).
  Future<void> _drawFriends(List<MemberPresence> presences) async {
    if (!_styleReady) return;
    final controller = _controller;
    if (controller == null) return;
    final myId = ref.read(currentUserProvider)?.id;
    final profiles =
        ref.read(groupProfilesProvider(widget.groupId)).valueOrNull ?? const {};

    final features = <Map<String, dynamic>>[];
    for (final p in presences) {
      if (p.userId == myId || p.position == null || !p.isFresh) continue;
      features.add({
        'type': 'Feature',
        'geometry': {
          'type': 'Point',
          'coordinates': p.position!.toGeoJsonCoords(),
        },
        'properties': {
          'user': p.userId,
          'color': profiles[p.userId]?.color ?? '#6EE7F0',
          'heading': p.heading ?? 0,
        },
      });
    }

    await _resetSource(_friendsSource, {
      'type': 'FeatureCollection',
      'features': features,
    });
    await controller.addCircleLayer(
      _friendsSource,
      '$_friendsSource-circles',
      const CircleLayerProperties(
        circleRadius: 8,
        circleColor: ['get', 'color'],
        circleStrokeWidth: 2,
        circleStrokeColor: '#EAF2FF',
      ),
    );
  }

  /// Supprime puis recrée une source GeoJSON (et ses couches suffixées).
  Future<void> _resetSource(String id, Map<String, dynamic> data) async {
    final controller = _controller!;
    for (final suffix in ['-fill', '-line', '-circles']) {
      await controller.removeLayer('$id$suffix').catchError((_) {});
    }
    await controller.removeSource(id).catchError((_) {});
    await controller.addGeoJsonSource(id, data);
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Icon(icon, color: AppColors.textPrimary),
        ),
      ),
    );
  }
}
