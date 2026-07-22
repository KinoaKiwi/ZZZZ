# Application Flutter — Gayeulle Party

Application mobile (iOS + Android) du jeu d'exploration GPS **Gayeulle Party**.

## Prérequis

- [Flutter](https://flutter.dev) ≥ 3.22 (Dart ≥ 3.4)
- Un backend Supabase démarré (voir [`../backend/supabase/README.md`](../backend/supabase/README.md))

## Configuration

```bash
cp .env.example .env
# Renseigner SUPABASE_URL et SUPABASE_ANON_KEY (fournis par `supabase start`).
```

## Lancer

Depuis la racine du dépôt, la première fois (génère les projets natifs + config) :

```bash
../tools/bootstrap.sh     # flutter create + permissions + background + deep links
```

Puis, à chaque fois :

```bash
flutter run
```

> Les versions des packages dans `pubspec.yaml` sont indicatives (cutoff début 2026).
> Si `flutter pub get` remonte des conflits, lancer `flutter pub upgrade --major-versions`.

## Architecture

Organisation **feature-first** avec couches `core` / `data` / `features`. Détails dans
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

```
lib/
├── main.dart                     # bootstrap (env + Supabase + runApp)
├── app.dart                      # MaterialApp.router + thème
├── core/
│   ├── config/                   # env, feature flags, constantes de jeu
│   ├── supabase/                 # providers du client Supabase / auth
│   ├── theme/                    # thème sombre néon (DA pixel art)
│   ├── routing/                  # go_router + redirection d'auth
│   └── location/                 # services GPS & compteur de pas
├── data/
│   ├── models/                   # Profile, Group, Session, Track, Geo…
│   └── repositories/             # Auth, Group, Session, Map
└── features/
    ├── auth/                     # connexion par code email (OTP)
    ├── group/                    # groupes privés (créer / rejoindre par lien)
    ├── map/                      # carte commune (brouillard, zones, tracés, amis, camps)
    ├── session/                  # session d'exploration (live + résumé + photos)
    ├── chat/                     # chat de groupe temps réel (texte, photos)
    └── places/                   # points d'intérêt / souvenirs géolocalisés
```

## État (Phase 1 — MVP) — code-complete

Implémenté : auth (OTP), groupes (RPC create/join + deep link d'invitation), carte
MapLibre avec chargement des tracés & zones, contrôleur de session (GPS + pas +
distance + durée + tracé), suivi **en arrière-plan** (foreground service Android /
background mode iOS) et clôture serveur avec révélation de zone.

Config native (permissions, background location, schéma `gayeulle://`) appliquée
automatiquement par [`../tools/bootstrap.sh`](../tools/bootstrap.sh).

> ⚠️ Non testé en environnement de génération (pas de SDK Flutter). À valider sur un
> appareil réel : précision GPS, comptage de pas, rendu de carte, permissions
> « always », continuation écran verrouillé.

## Permissions natives (appliquées par bootstrap.sh)

- **iOS** (`ios/Runner/Info.plist`) : `NSLocationWhenInUseUsageDescription`,
  `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSMotionUsageDescription`,
  `UIBackgroundModes = [location]`, `CFBundleURLTypes` (schéma `gayeulle`).
- **Android** (`android/app/src/main/AndroidManifest.xml`) :
  `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `ACTIVITY_RECOGNITION`,
  `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`,
  + intent-filter deep link `gayeulle://`.

## Tests

```bash
flutter test
```
