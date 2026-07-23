import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../routing/app_router.dart';

/// Écoute les deep links entrants (`gayeulle://…`) et les route vers l'app.
///
/// Cas principal : le lien d'invitation `gayeulle://join?token=…` → écran groupes
/// avec adhésion automatique au groupe.
class DeepLinkService {
  DeepLinkService(this._ref);

  final Ref _ref;
  final AppLinks _appLinks = AppLinks();
  StreamSubscription<Uri>? _sub;

  Future<void> start() async {
    // Lien ayant démarré l'app à froid.
    final initial = await _appLinks.getInitialLink();
    if (initial != null) _handle(initial);

    // Liens reçus pendant que l'app tourne.
    _sub = _appLinks.uriLinkStream.listen(_handle);
  }

  void _handle(Uri uri) {
    final router = _ref.read(routerProvider);
    // gayeulle://join?token=XYZ  (host = 'join')
    if (uri.host == 'join' || uri.path.contains('join')) {
      final token = uri.queryParameters['token'];
      if (token != null && token.isNotEmpty) {
        router.go('/groups?token=$token');
        return;
      }
    }
    router.go('/groups');
  }

  void dispose() => _sub?.cancel();
}

final deepLinkServiceProvider = Provider<DeepLinkService>((ref) {
  final service = DeepLinkService(ref);
  ref.onDispose(service.dispose);
  return service;
});
