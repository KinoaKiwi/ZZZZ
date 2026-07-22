import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Accès typé aux variables d'environnement (chargées depuis `.env`).
///
/// Charger via [Env.load] au démarrage, avant [runApp].
class Env {
  const Env._();

  static Future<void> load() => dotenv.load(fileName: '.env');

  static String get supabaseUrl => _require('SUPABASE_URL');
  static String get supabaseAnonKey => _require('SUPABASE_ANON_KEY');

  static String get mapStyleUrl =>
      dotenv.maybeGet('MAP_STYLE_URL') ?? 'https://tiles.openfreemap.org/styles/dark';

  static String get osrmBaseUrl =>
      dotenv.maybeGet('OSRM_BASE_URL') ?? 'https://router.project-osrm.org';

  static String _require(String key) {
    final value = dotenv.maybeGet(key);
    if (value == null || value.isEmpty) {
      throw StateError('Variable d\'environnement manquante : $key (voir .env.example)');
    }
    return value;
  }
}
