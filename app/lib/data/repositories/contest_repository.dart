import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/supabase/supabase_providers.dart';
import '../models/contest_item.dart';
import '../models/game_event.dart';
import '../models/geo_point.dart';

/// Événements (Contest, Contest Boussole, expéditions), objets et scoring.
class ContestRepository {
  ContestRepository(this._client);

  final SupabaseClient _client;

  // ── Événements ─────────────────────────────────────────────────────────

  /// Un événement par son id.
  Future<GameEvent> getEvent(String eventId) async {
    final row = await _client
        .from('events')
        .select('id, group_id, created_by, kind, status, rules')
        .eq('id', eventId)
        .single();
    return GameEvent.fromMap(row);
  }

  Future<List<GameEvent>> listEvents(String groupId) async {
    final rows = await _client
        .from('events')
        .select('id, group_id, created_by, kind, status, rules')
        .eq('group_id', groupId)
        .order('created_at', ascending: false);
    return (rows as List)
        .map((r) => GameEvent.fromMap(r as Map<String, dynamic>))
        .toList();
  }

  /// L'événement actif du groupe (requête ponctuelle), s'il y en a un.
  Future<GameEvent?> activeEventOnce(String groupId) async {
    final row = await _client
        .from('events')
        .select('id, group_id, created_by, kind, status, rules')
        .eq('group_id', groupId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
    return row == null ? null : GameEvent.fromMap(row);
  }

  /// L'événement actif du groupe (le premier trouvé), s'il y en a un.
  Stream<GameEvent?> watchActiveEvent(String groupId) {
    return _client
        .from('events')
        .stream(primaryKey: ['id'])
        .eq('group_id', groupId)
        .map((rows) {
          for (final r in rows) {
            if (r['status'] == 'active') return GameEvent.fromMap(r);
          }
          return null;
        });
  }

  /// Crée un événement (réservé à l'admin — vérifié par le RLS). [target] sert
  /// de cible de navigation en Mode Boussole.
  Future<GameEvent> createEvent({
    required String groupId,
    required EventKind kind,
    GeoPoint? target,
  }) async {
    final userId = _client.auth.currentUser!.id;
    final rules = <String, dynamic>{
      if (target != null) 'target': {'lat': target.lat, 'lng': target.lng},
    };
    final row = await _client
        .from('events')
        .insert({
          'group_id': groupId,
          'created_by': userId,
          'kind': eventKindToString(kind),
          'status': 'scheduled',
          'rules': rules,
        })
        .select('id, group_id, created_by, kind, status, rules')
        .single();
    return GameEvent.fromMap(row);
  }

  /// Change le statut d'un événement (admin) : scheduled → active → ended.
  Future<void> setStatus(String eventId, EventStatus status) {
    return _client
        .from('events')
        .update({'status': eventStatusToString(status)}).eq('id', eventId);
  }

  /// Rejoint un événement (crée sa ligne de participant).
  Future<void> join(String eventId) {
    final userId = _client.auth.currentUser!.id;
    return _client.from('event_participants').upsert({
      'event_id': eventId,
      'user_id': userId,
    });
  }

  /// Classement d'un événement (participants + profils + scores), en direct.
  Stream<List<EventStanding>> watchLeaderboard(String eventId) {
    return _client
        .from('event_participants')
        .stream(primaryKey: ['event_id', 'user_id'])
        .eq('event_id', eventId)
        .map((rows) => rows.map(EventStanding.fromMap).toList()
          ..sort((a, b) => b.score.compareTo(a.score)));
  }

  /// Classement enrichi des profils (noms/couleurs) — requête ponctuelle.
  Future<List<EventStanding>> leaderboard(String eventId) async {
    final rows = await _client
        .from('event_participants')
        .select('user_id, score, profiles(display_name, color)')
        .eq('event_id', eventId)
        .order('score', ascending: false);
    return (rows as List)
        .map((r) => EventStanding.fromMap(r as Map<String, dynamic>))
        .toList();
  }

  // ── Objets Contest ─────────────────────────────────────────────────────

  /// Catalogue des objets avec le stock du joueur pour ce groupe.
  Future<List<ContestItem>> items(String groupId) async {
    final userId = _client.auth.currentUser!.id;
    final catalogue = await _client
        .from('contest_items')
        .select('code, name, price, description');
    final inv = await _client
        .from('contest_inventory')
        .select('item_code, quantity')
        .eq('user_id', userId)
        .eq('group_id', groupId);
    final qty = <String, int>{
      for (final r in inv as List)
        (r as Map)['item_code'] as String: (r['quantity'] as num).toInt(),
    };
    return (catalogue as List).map((r) {
      final map = r as Map<String, dynamic>;
      return ContestItem.fromMap(map, quantity: qty[map['code']] ?? 0);
    }).toList();
  }

  /// Achète [qty] exemplaires d'un objet (débit Djadja Coins, serveur).
  Future<void> buy(String groupId, String code, int qty) {
    return _client.rpc('buy_contest_item', params: {
      'p_group_id': groupId,
      'p_item_code': code,
      'p_qty': qty,
    });
  }

  /// Utilise un objet à un point visé (résolution serveur).
  Future<void> useItem({
    required String eventId,
    required String code,
    required GeoPoint at,
  }) {
    return _client.rpc('use_contest_item', params: {
      'p_event_id': eventId,
      'p_item_code': code,
      'p_lat': at.lat,
      'p_lng': at.lng,
    });
  }

  /// Récupération passive : signale le chemin parcouru pour récupérer les
  /// portions de tracés adverses traversées (Mode Contest).
  Future<void> passRecover(String eventId, GeoLine path) {
    if (path.length < 2) return Future.value();
    return _client.rpc('contest_pass_recover', params: {
      'p_event_id': eventId,
      'p_line': path.toGeoJson(),
    });
  }
}

final contestRepositoryProvider = Provider<ContestRepository>((ref) {
  return ContestRepository(ref.watch(supabaseClientProvider));
});

/// Événement actif du groupe (null si aucun).
final activeEventProvider =
    StreamProvider.family<GameEvent?, String>((ref, groupId) {
  return ref.watch(contestRepositoryProvider).watchActiveEvent(groupId);
});

/// Liste des événements d'un groupe.
final eventsProvider =
    FutureProvider.family<List<GameEvent>, String>((ref, groupId) {
  return ref.watch(contestRepositoryProvider).listEvents(groupId);
});

/// Objets Contest du joueur pour un groupe.
final contestItemsProvider =
    FutureProvider.family<List<ContestItem>, String>((ref, groupId) {
  return ref.watch(contestRepositoryProvider).items(groupId);
});

/// Un événement par id.
final eventByIdProvider =
    FutureProvider.family<GameEvent, String>((ref, eventId) {
  return ref.watch(contestRepositoryProvider).getEvent(eventId);
});
