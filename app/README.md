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

```bash
flutter pub get
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
    ├── map/                      # carte commune (brouillard, zones, tracés)
    └── session/                  # session d'exploration (live + résumé)
```

## État (Phase 1 — MVP)

Implémenté : squelette d'auth, groupes (RPC create/join), carte MapLibre avec
chargement des tracés & zones, contrôleur de session (GPS + pas + distance +
durée + tracé) et clôture serveur avec révélation de zone.

À compléter avant démo : configuration des permissions natives (iOS `Info.plist`,
Android `AndroidManifest.xml`), foreground service pour le suivi en arrière-plan,
style de carte sombre pixel-art, gestion fine des deep links d'invitation.

## Permissions natives à déclarer

- **iOS** (`ios/Runner/Info.plist`) : `NSLocationWhenInUseUsageDescription`,
  `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSMotionUsageDescription`,
  background modes `location`.
- **Android** (`android/app/src/main/AndroidManifest.xml`) :
  `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `ACTIVITY_RECOGNITION`,
  `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`.

## Tests

```bash
flutter test
```
