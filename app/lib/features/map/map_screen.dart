import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../../core/config/env.dart';
import '../../core/theme/app_colors.dart';
import '../../data/repositories/map_repository.dart';

/// Carte commune du groupe : fond sombre, brouillard d'exploration percé par les
/// zones découvertes, tracés colorés des joueurs. Hub principal de la Phase 1.
class MapScreen extends ConsumerStatefulWidget {
  const MapScreen({super.key, required this.groupId});

  final String groupId;

  @override
  ConsumerState<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends ConsumerState<MapScreen> {
  MaplibreMapController? _controller;

  static const _zonesSource = 'discovered-zones';
  static const _tracksSourcePrefix = 'track-';

  @override
  Widget build(BuildContext context) {
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
          ),
          // Voile de brouillard global (les zones découvertes le percent visuellement
          // via une couche claire par-dessus — voir _onStyleLoaded).
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
    await _reloadLayers();
  }

  /// (Re)charge les zones découvertes et les tracés depuis Supabase et les
  /// dessine sur la carte.
  Future<void> _reloadLayers() async {
    final controller = _controller;
    if (controller == null) return;
    final repo = ref.read(mapRepositoryProvider);

    // --- Zones découvertes (couche de révélation) ---
    final zones = await repo.discoveredZonesFeatureCollection(widget.groupId);
    await controller.removeLayer('zones-fill').catchError((_) {});
    await controller.removeSource(_zonesSource).catchError((_) {});
    await controller.addGeoJsonSource(_zonesSource, zones);
    await controller.addFillLayer(
      _zonesSource,
      'zones-fill',
      const FillLayerProperties(
        fillColor: '#1E2634',
        fillOpacity: 0.85, // éclaircit la zone révélée sous le brouillard
      ),
    );

    // --- Tracés colorés par propriétaire ---
    final tracks = await repo.tracks(widget.groupId);
    for (final track in tracks) {
      final srcId = '$_tracksSourcePrefix${track.id}';
      final feature = {
        'type': 'Feature',
        'geometry': track.line.toGeoJson(),
        'properties': {'owner': track.userId},
      };
      await controller.removeLayer('$srcId-line').catchError((_) {});
      await controller.removeSource(srcId).catchError((_) {});
      await controller.addGeoJsonSource(srcId, feature);
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
