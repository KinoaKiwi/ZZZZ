import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/auth_screen.dart';
import '../../features/chat/chat_screen.dart';
import '../../features/companion/companion_screen.dart';
import '../../features/group/group_screen.dart';
import '../../features/map/map_screen.dart';
import '../../features/missions/missions_screen.dart';
import '../../features/session/session_screen.dart';
import '../../features/shop/shop_screen.dart';
import '../supabase/supabase_providers.dart';

/// Router applicatif avec redirection selon l'état d'authentification.
///
/// Gère aussi le deep link d'invitation `gayeulle://join?token=…` (route /join).
final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _AuthRefreshNotifier(ref);

  return GoRouter(
    initialLocation: '/groups',
    refreshListenable: refresh,
    redirect: (context, state) {
      final loggedIn = ref.read(currentUserProvider) != null;
      final onAuth = state.matchedLocation == '/auth';
      if (!loggedIn) return onAuth ? null : '/auth';
      if (onAuth) return '/groups';
      return null;
    },
    routes: [
      GoRoute(path: '/auth', builder: (_, __) => const AuthScreen()),
      GoRoute(
        path: '/groups',
        builder: (_, s) => GroupScreen(inviteToken: s.uri.queryParameters['token']),
      ),
      GoRoute(
        path: '/map/:groupId',
        builder: (_, s) => MapScreen(groupId: s.pathParameters['groupId']!),
      ),
      GoRoute(
        path: '/session/:groupId',
        builder: (_, s) => SessionScreen(groupId: s.pathParameters['groupId']!),
      ),
      GoRoute(
        path: '/chat/:groupId',
        builder: (_, s) => ChatScreen(groupId: s.pathParameters['groupId']!),
      ),
      GoRoute(
        path: '/missions/:groupId',
        builder: (_, s) => MissionsScreen(groupId: s.pathParameters['groupId']!),
      ),
      GoRoute(
        path: '/shop/:groupId',
        builder: (_, s) => ShopScreen(groupId: s.pathParameters['groupId']!),
      ),
      GoRoute(
        path: '/companion/:groupId',
        builder: (_, s) => CompanionScreen(groupId: s.pathParameters['groupId']!),
      ),
      // Deep link d'invitation : /join?token=… (à traiter dans GroupScreen).
      GoRoute(
        path: '/join',
        redirect: (_, s) {
          final token = s.uri.queryParameters['token'];
          // On redirige vers les groupes ; le token peut être passé plus loin.
          return token == null ? '/groups' : '/groups?token=$token';
        },
      ),
    ],
  );
});

/// Rafraîchit le router quand l'état d'authentification change.
class _AuthRefreshNotifier extends ChangeNotifier {
  _AuthRefreshNotifier(Ref ref) {
    ref.listen(authStateProvider, (_, __) => notifyListeners());
  }
}
