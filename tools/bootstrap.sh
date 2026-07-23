#!/usr/bin/env bash
# ============================================================================
# Gayeulle Party — bootstrap
# ----------------------------------------------------------------------------
# Génère les projets natifs iOS/Android (que `flutter create` produit) puis
# applique la configuration du jeu (permissions, background location, deep links)
# et installe les dépendances. À lancer sur une machine avec Flutter installé.
#
#   ./tools/bootstrap.sh
#   cd app && flutter run
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/app"
ORG="com.gayeulle"
NAME="gayeulle_party"

if ! command -v flutter >/dev/null 2>&1; then
  echo "❌ Flutter est requis. Installe-le : https://flutter.dev/docs/get-started/install"
  exit 1
fi

echo "▶ Flutter détecté :"
flutter --version | head -n 1

cd "$APP"

# 1. Génère les dossiers natifs manquants (android/, ios/) sans toucher à lib/.
echo "▶ Génération des projets natifs (android, ios)…"
flutter create --org "$ORG" --project-name "$NAME" --platforms=android,ios .

# 2. Overlay Android : permissions + deep link d'invitation.
echo "▶ Application de l'AndroidManifest (permissions, deep links)…"
cp "$ROOT/tools/native-overlay/android/AndroidManifest.xml" \
   "$APP/android/app/src/main/AndroidManifest.xml"

# 3. Clés iOS : permissions + background location + schéma gayeulle://.
PLIST="$APP/ios/Runner/Info.plist"
if [ -f "$PLIST" ] && command -v /usr/libexec/PlistBuddy >/dev/null 2>&1; then
  echo "▶ Application des clés Info.plist (iOS)…"
  bash "$ROOT/tools/native-overlay/ios/apply_info_plist.sh" "$PLIST"
else
  echo "ℹ️  iOS : PlistBuddy indisponible (hors macOS). Applique manuellement les clés"
  echo "    listées dans tools/native-overlay/ios/apply_info_plist.sh."
fi

# 4. Environnement + dépendances.
if [ ! -f "$APP/.env" ]; then
  echo "▶ Création de app/.env depuis .env.example (à compléter !)…"
  cp "$APP/.env.example" "$APP/.env"
fi

echo "▶ flutter pub get…"
flutter pub get

echo ""
echo "✅ Terminé."
echo "   1) Renseigne app/.env (SUPABASE_URL, SUPABASE_ANON_KEY) — cf. backend/supabase/README.md"
echo "   2) cd app && flutter run"
