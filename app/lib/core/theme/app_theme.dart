import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Thème sombre « gaming » de Gayeulle Party.
///
/// Note DA : le pixel art HD (polices bitmap, textures) s'ajoute via des assets
/// (fonts pixel, `image_pixels`) au fil des phases. Ce thème pose la base
/// sombre/néon et les composants Material.
class AppTheme {
  const AppTheme._();

  static ThemeData get dark {
    const scheme = ColorScheme.dark(
      primary: AppColors.neonCyan,
      secondary: AppColors.neonMagenta,
      surface: AppColors.surface,
      error: AppColors.danger,
      onPrimary: AppColors.background,
      onSecondary: AppColors.background,
      onSurface: AppColors.textPrimary,
    );

    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: scheme,
      scaffoldBackgroundColor: AppColors.background,
      // fontFamily: 'PixelHD', // à déclarer dans pubspec (assets/fonts) — DA pixel art
    );

    return base.copyWith(
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        centerTitle: true,
      ),
      cardTheme: CardTheme(
        color: AppColors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        margin: const EdgeInsets.all(8),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.neonCyan,
          foregroundColor: AppColors.background,
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontWeight: FontWeight.w700, letterSpacing: 0.5),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surfaceHigh,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
        hintStyle: const TextStyle(color: AppColors.textFaint),
      ),
      textTheme: base.textTheme.apply(
        bodyColor: AppColors.textPrimary,
        displayColor: AppColors.textPrimary,
      ),
    );
  }
}
