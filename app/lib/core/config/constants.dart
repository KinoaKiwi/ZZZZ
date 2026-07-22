/// Constantes de jeu partagées côté client.
///
/// Les valeurs qui influent sur l'équité (récupération de tracé, économie) font
/// autorité côté serveur ; celles-ci ne servent qu'à l'affichage et au calcul
/// local d'une session.
class GameConstants {
  const GameConstants._();

  /// Rayon (mètres) de révélation autour d'un tracé — miroir de
  /// `reveal_radius_m()` côté SQL (voir 0004_phase1_discovery.sql).
  static const double revealRadiusM = 50;

  /// Distance minimale (mètres) entre deux points GPS pour enrichir le tracé.
  /// Filtre le bruit GPS à l'arrêt.
  static const double minPointDistanceM = 5;

  /// Précision GPS maximale acceptée (mètres) ; au-delà, le point est ignoré.
  static const double maxAcceptableAccuracyM = 30;

  /// Vitesse de marche plausible maximale (m/s) ~ 12 km/h. Au-delà, point écarté
  /// (anti-triche léger côté client ; le serveur reste autoritaire).
  static const double maxWalkingSpeedMps = 3.5;

  /// Schéma de deep link pour les liens d'invitation de groupe.
  static const String deepLinkScheme = 'gayeulle';
}

/// Palette de couleurs proposées aux joueurs (chacun a sa couleur de tracé).
const List<String> kPlayerColors = <String>[
  '#6EE7F0', // cyan néon
  '#F06EC8', // magenta
  '#A6F06E', // vert lime
  '#F0C86E', // ambre
  '#B06EF0', // violet
  '#F0806E', // corail
  '#6E9CF0', // bleu
  '#6EF0A6', // menthe
];
