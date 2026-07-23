import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/deep_link/deep_link_service.dart';
import 'core/routing/app_router.dart';
import 'core/theme/app_theme.dart';

/// Racine de l'application Gayeulle Party.
class GayeulleApp extends ConsumerStatefulWidget {
  const GayeulleApp({super.key});

  @override
  ConsumerState<GayeulleApp> createState() => _GayeulleAppState();
}

class _GayeulleAppState extends ConsumerState<GayeulleApp> {
  @override
  void initState() {
    super.initState();
    // Démarre l'écoute des liens d'invitation (gayeulle://join?token=…).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(deepLinkServiceProvider).start();
    });
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'Gayeulle Party',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark,
      routerConfig: router,
    );
  }
}
