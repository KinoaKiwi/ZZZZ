#!/usr/bin/env bash
# Ajoute les clés iOS nécessaires (permissions, background location, deep link)
# à l'Info.plist généré par `flutter create`. À exécuter sur macOS (PlistBuddy).
#
# Usage : apply_info_plist.sh <chemin/vers/Info.plist>
set -euo pipefail

PLIST="${1:?Usage: apply_info_plist.sh <Info.plist>}"
PB=/usr/libexec/PlistBuddy

# Ajoute une clé si absente, sinon met à jour sa valeur (string).
set_string() {
  local key="$1" val="$2"
  if $PB -c "Print :$key" "$PLIST" >/dev/null 2>&1; then
    $PB -c "Set :$key $val" "$PLIST"
  else
    $PB -c "Add :$key string $val" "$PLIST"
  fi
}

# ── Permissions localisation & mouvement ──
set_string "NSLocationWhenInUseUsageDescription" \
  "Gayeulle Party utilise ta position pour tracer tes explorations et révéler la carte."
set_string "NSLocationAlwaysAndWhenInUseUsageDescription" \
  "Gayeulle Party continue de suivre ta session même écran verrouillé pour ne rien perdre de ton tracé."
set_string "NSMotionUsageDescription" \
  "Gayeulle Party compte tes pas pendant une session d'exploration."

# ── Background mode : location ──
if ! $PB -c "Print :UIBackgroundModes" "$PLIST" >/dev/null 2>&1; then
  $PB -c "Add :UIBackgroundModes array" "$PLIST"
fi
if ! $PB -c "Print :UIBackgroundModes" "$PLIST" 2>/dev/null | grep -q "location"; then
  $PB -c "Add :UIBackgroundModes: string location" "$PLIST"
fi

# ── Deep link : schéma gayeulle:// ──
if ! $PB -c "Print :CFBundleURLTypes" "$PLIST" >/dev/null 2>&1; then
  $PB -c "Add :CFBundleURLTypes array" "$PLIST"
  $PB -c "Add :CFBundleURLTypes:0 dict" "$PLIST"
  $PB -c "Add :CFBundleURLTypes:0:CFBundleURLName string com.gayeulle.gayeulle_party" "$PLIST"
  $PB -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST"
  $PB -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string gayeulle" "$PLIST"
fi

echo "✅ Info.plist mis à jour : $PLIST"
