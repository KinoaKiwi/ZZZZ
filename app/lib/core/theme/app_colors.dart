import 'package:flutter/material.dart';

/// Palette de la direction artistique : sombre, néon, rétro-futuriste.
/// Voir le cahier des charges — « couleurs néon », « monde vivant ».
class AppColors {
  const AppColors._();

  // Fonds sombres (carte cachée, brouillard).
  static const Color background = Color(0xFF0B0E14);
  static const Color surface = Color(0xFF141A24);
  static const Color surfaceHigh = Color(0xFF1E2634);
  static const Color fog = Color(0xF20B0E14); // masque de brouillard (alpha élevé)

  // Accents néon.
  static const Color neonCyan = Color(0xFF6EE7F0);
  static const Color neonMagenta = Color(0xFFF06EC8);
  static const Color neonLime = Color(0xFFA6F06E);
  static const Color neonAmber = Color(0xFFF0C86E);
  static const Color neonViolet = Color(0xFFB06EF0);

  // Texte.
  static const Color textPrimary = Color(0xFFEAF2FF);
  static const Color textSecondary = Color(0xFF9AA7BD);
  static const Color textFaint = Color(0xFF5C6B84);

  // États.
  static const Color success = Color(0xFF6EF0A6);
  static const Color danger = Color(0xFFF0806E);

  static const Color primary = neonCyan;
  static const Color secondary = neonMagenta;

  /// Convertit une couleur hex de joueur (`#RRGGBB`) en [Color].
  static Color fromHex(String hex) {
    var value = hex.replaceFirst('#', '');
    if (value.length == 6) value = 'FF$value';
    return Color(int.parse(value, radix: 16));
  }
}
