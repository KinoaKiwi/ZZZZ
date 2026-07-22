/// Active/désactive les modules selon la phase de développement.
///
/// Permet de livrer la roadmap phase par phase sans brancher/débrancher le code.
/// Voir docs/ROADMAP.md.
class FeatureFlags {
  const FeatureFlags._();

  // Phase 1 — MVP (toujours actif).
  static const bool groups = true;
  static const bool sessions = true;
  static const bool map = true;

  // Phase 2 — vie du groupe.
  static const bool photos = false;
  static const bool chat = false;
  static const bool realtime = false;
  static const bool camps = false;

  // Phase 3 — économie & progression.
  static const bool economy = false;
  static const bool shop = false;
  static const bool missions = false;
  static const bool companion = false;

  // Phase 4 — Contest & événements.
  static const bool contest = false;
  static const bool compass = false;
}
