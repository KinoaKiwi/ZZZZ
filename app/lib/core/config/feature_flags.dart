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
  static const bool photos = true;
  static const bool chat = true;
  static const bool realtime = true;
  static const bool camps = true;

  // Phase 3 — économie & progression.
  static const bool economy = true;
  static const bool shop = true;
  static const bool missions = true;
  static const bool companion = true;

  // Phase 4 — Contest & événements.
  static const bool contest = false;
  static const bool compass = false;
}
