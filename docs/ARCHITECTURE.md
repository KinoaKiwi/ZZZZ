# Architecture technique — Gayeulle Party

Ce document décrit l'architecture technique de l'application, les choix de stack et le découpage
en couches. Il traduit le cahier des charges en décisions actionnables.

---

## 1. Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────┐
│                    APPLICATION FLUTTER                         │
│                                                                │
│   Presentation (features/*/presentation)                       │
│      écrans · widgets · state (Riverpod)                       │
│              │                                                  │
│   Domain     ▼                                                 │
│      modèles · use-cases · règles de jeu                       │
│              │                                                  │
│   Data       ▼                                                 │
│      repositories · sources (Supabase, GPS, pas, carte)        │
└──────────────┼───────────────────────────────────────────────┘
               │ HTTPS / WebSocket
               ▼
┌──────────────────────────────────────────────────────────────┐
│                        SUPABASE                                │
│   Auth  ·  PostgreSQL + PostGIS  ·  Storage  ·  Realtime       │
│   Row Level Security  ·  Edge Functions (règles serveur)       │
└──────────────┬───────────────────────────────────────────────┘
               │
      ┌────────┴─────────┐
      ▼                  ▼
┌───────────┐     ┌──────────────────────┐
│   OSRM    │     │  Tuiles cartes (OSM)  │
│ (routing  │     │  OpenFreeMap /        │
│  piéton)  │     │  OpenMapTiles         │
└───────────┘     └──────────────────────┘
```

## 2. Application mobile — Flutter

**Choix : Flutter / Dart.** Un seul code pour iOS + Android, performances natives, riche
écosystème de packages GPS/carte, animations fluides adaptées à une UI gaming.

### 2.1 Organisation du code (feature-first + clean layers)

```
lib/
├── main.dart                      # bootstrap (env, Supabase, runApp)
├── app.dart                       # MaterialApp, thème, routing racine
├── core/
│   ├── config/                    # env, constantes, feature flags par phase
│   ├── supabase/                  # client Supabase, helpers auth
│   ├── theme/                     # thème sombre pixel-art (couleurs, typo)
│   ├── routing/                   # routes nommées (go_router)
│   ├── location/                  # service GPS + service background
│   └── utils/                     # helpers géo, formatage, extensions
├── data/
│   ├── models/                    # entités sérialisables (Group, Profile, Track…)
│   └── repositories/              # accès données (interface + impl Supabase)
└── features/
    ├── auth/                      # connexion, session utilisateur
    ├── group/                     # groupe privé, invitation, membres
    ├── map/                       # carte commune, brouillard, tracés, zones
    ├── session/                   # session d'exploration (GPS, pas, résumé)
    ├── realtime/          (P2)    # positions live
    ├── chat/              (P2)    # chat de groupe
    ├── places/            (P2)    # photos & points d'intérêt
    ├── camps/             (P2)    # campements
    ├── economy/           (P3)    # Djadja Coins, portefeuille, transactions
    ├── shop/              (P3)    # boutique cosmétique
    ├── missions/          (P3)    # missions journalières
    ├── companion/         (P3)    # compagnon
    └── contest/           (P4)    # Contest, objets, Mode Boussole, événements
```

Les dossiers marqués `(P2/P3/P4)` sont créés au fil de la roadmap. La Phase 1 n'implémente
que `auth`, `group`, `map`, `session`.

### 2.2 Gestion d'état

**Choix : Riverpod.** Providers testables, injection de dépendances simple, bon support de
l'async (streams Realtime, position GPS). Alternative envisagée : Bloc (plus verbeux ici).

### 2.3 Navigation

**Choix : go_router.** Routing déclaratif, deep links (pour les liens d'invitation de groupe
`gayeulle://join?token=…` et les liens universels), redirections selon l'état d'auth.

### 2.4 Services critiques

| Service          | Package                          | Rôle                                                   |
| ---------------- | -------------------------------- | ------------------------------------------------------ |
| Localisation     | `geolocator`                     | Position ponctuelle et flux de positions               |
| Background       | `flutter_background_geolocation` ou `flutter_foreground_task` | tracé en veille / écran verrouillé      |
| Compteur de pas  | `pedometer` + `health`           | pas natifs (HealthKit / Health Connect)                |
| Carte            | `maplibre_gl`                    | rendu vectoriel, style sombre custom, couches tracés   |
| Permissions      | `permission_handler`             | localisation « always », activité physique, caméra     |
| Stockage local   | `shared_preferences` / `drift`   | cache hors-ligne des tracés d'une session              |

> **Sessions en arrière-plan** : le tracé doit continuer écran verrouillé / téléphone en veille.
> On combine un **foreground service Android** (notification persistante) et les **background
> location modes iOS**. Les points sont bufferisés localement (SQLite via `drift`) puis
> synchronisés vers Supabase par lots pour économiser batterie et réseau.

## 3. Backend — Supabase

**Choix : Supabase.** Fournit d'un coup l'auth, une base PostgreSQL (extensible avec PostGIS),
le stockage d'images, et le temps réel — exactement le périmètre du cahier des charges, en
open source auto-hébergeable si besoin.

### 3.1 Base de données : PostgreSQL + PostGIS

Toute la logique géographique repose sur **PostGIS** :

- **tracés** = `geography(LineString, 4326)` (suite de points GPS d'une session) ;
- **zones découvertes** = `geography(Polygon/MultiPolygon, 4326)` (buffer autour des tracés) ;
- **points d'intérêt / positions** = `geography(Point, 4326)` ;
- calculs : longueur d'un tracé (`ST_Length`), superficie révélée (`ST_Area`), test « je passe
  sur le tracé d'un ami » en Contest (`ST_DWithin`), fusion de zones (`ST_Union`).

Le schéma complet est décrit dans [`DATA_MODEL.md`](DATA_MODEL.md) et versionné dans
`backend/supabase/migrations/`.

### 3.2 Sécurité : Row Level Security (RLS)

Le jeu est **privé et cloisonné par groupe**. La règle d'or : _un membre ne voit que les
données des groupes auxquels il appartient_. Chaque table porteuse de données de jeu a une
colonne `group_id` et des policies RLS qui vérifient l'appartenance via la table
`group_members`. Aucune donnée n'est publique.

### 3.3 Logique serveur : Edge Functions / RPC

Certaines règles ne doivent pas être arbitrables par le client (anti-triche, économie) :

- crédit/débit de **Djadja Coins** (missions, achats boutique) ;
- résolution des actions **Contest** (bombe, pinceau, rouleau, bouclier) : découpe/fusion de
  tracés et zones en base ;
- validation d'une **session** (distance/pas plausibles) avant récompense ;
- sortie quotidienne du **compagnon** (une fois par jour, révèle 100 m).

Ces opérations passent par des fonctions PostgreSQL (`SECURITY DEFINER`) ou des Edge Functions,
jamais par des écritures directes du client.

## 4. Cartographie

| Besoin           | Choix                     | Alternative            |
| ---------------- | ------------------------- | ---------------------- |
| Moteur de rendu  | **MapLibre GL**           | —                      |
| Données          | **OpenStreetMap**         | —                      |
| Tuiles vecteur   | **OpenFreeMap**           | OpenMapTiles auto-héb. |
| Routing piéton   | **OSRM** (profil `foot`)  | GraphHopper            |

Le **style de carte** est un fichier JSON MapLibre custom : palette sombre, routes texturées,
ambiance néon/rétro-futuriste. Le **brouillard d'exploration** est une couche supplémentaire
(masque sombre) percée par les zones découvertes du groupe (polygones PostGIS servis en
GeoJSON / tuiles). Les tracés des joueurs sont des couches lignes colorées par propriétaire.

## 5. Temps réel

**Supabase Realtime** diffuse :

- les **positions live** des membres (avec respect du réglage de visibilité : visible /
  visible pendant session / invisible) ;
- les **nouvelles découvertes** (une zone révélée apparaît chez tout le groupe) ;
- les **messages de chat** ;
- l'état des **événements** (Contest en cours, etc.).

Les positions live à haute fréquence peuvent transiter par un canal Realtime « broadcast »
(non persistant) plutôt que par des writes en base, pour limiter la charge.

## 6. Notifications

**Firebase Cloud Messaging** : invitation à un groupe, début d'un événement (Contest,
expédition), rappel de mission / de sortie du compagnon, message de chat.

## 7. Stockage d'images

**Supabase Storage** : photos de session, images de points d'intérêt / souvenirs. Buckets
cloisonnés par groupe, accès contrôlé par policies alignées sur le RLS. Alternative
auto-hébergeable : MinIO.

## 8. Anti-triche & confidentialité (principes)

- **Confidentialité** : rien de public ; visibilité de position réglable par l'utilisateur ;
  données géographiques précises considérées comme sensibles.
- **Anti-triche** : plausibilité des sessions (vitesse piéton, cohérence pas/distance), règles
  d'économie et de Contest côté serveur uniquement.
- **Marche uniquement** : la navigation et le calcul de progression supposent un profil piéton ;
  les vitesses incohérentes avec la marche sont écartées du scoring.

## 9. Feature flags par phase

Un simple registre de flags (`core/config/feature_flags.dart`) active/désactive les modules
selon la phase, pour livrer progressivement sans brancher/rebrancher le code :

```dart
class FeatureFlags {
  static const bool photos      = false; // Phase 2
  static const bool chat        = false; // Phase 2
  static const bool realtime    = false; // Phase 2
  static const bool camps       = false; // Phase 2
  static const bool economy     = false; // Phase 3
  static const bool shop        = false; // Phase 3
  static const bool missions    = false; // Phase 3
  static const bool companion   = false; // Phase 3
  static const bool contest     = false; // Phase 4
  static const bool compass     = false; // Phase 4
}
```
