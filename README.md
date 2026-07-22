<div align="center">

# 🗺️ Gayeulle Party

**Transformez le monde réel en monde de jeu.**

Application mobile privée d'exploration GPS entre amis — pixel art HD, carte commune à découvrir,
sessions de marche, événements et économie virtuelle cosmétique.

`Flutter` · `Supabase` · `PostgreSQL + PostGIS` · `MapLibre` · `OpenStreetMap`

</div>

---

## 🎯 Le concept

Gayeulle Party n'est **pas** un réseau social public. C'est un jeu privé, réservé à un groupe
d'amis, qui transforme leurs balades réelles en aventure partagée.

Chaque déplacement à pied :

- **révèle** une carte cachée sous un brouillard d'exploration,
- **enregistre** un tracé coloré appartenant à son auteur,
- **construit** une carte commune vivante pour tout le groupe,
- **récompense** l'exploration (Djadja Coins, missions, compagnon),
- **anime** la vie du groupe (chat, photos, campements, événements).

> _« Notre ville devient notre monde de jeu. »_

## 🧭 Ce dépôt

Ce dépôt est un **monorepo** contenant l'application mobile et son backend.

```
gayeulle-party/
├── app/                  # Application mobile Flutter (iOS + Android)
│   └── lib/
│       ├── core/         # Thème, config, client Supabase, routing, utils
│       ├── data/         # Modèles, repositories, sources de données
│       └── features/     # Fonctionnalités par domaine (auth, group, map, session…)
├── backend/
│   └── supabase/
│       └── migrations/   # Schéma PostgreSQL + PostGIS (SQL versionné)
└── docs/                 # Architecture, modèle de données, roadmap, game design
```

## 🏗️ Stack technique

| Couche            | Technologie                              | Pourquoi                                    |
| ----------------- | ---------------------------------------- | ------------------------------------------- |
| Mobile            | **Flutter / Dart**                       | iOS + Android, un seul code, performant     |
| Backend / Auth    | **Supabase**                             | Auth, Postgres, Storage, Realtime           |
| Base de données   | **PostgreSQL + PostGIS**                 | GPS, zones, tracés, calculs géographiques   |
| Carte             | **MapLibre GL** + tuiles OpenStreetMap   | Open source, stylable (thème sombre pixel)  |
| Routing piéton    | **OSRM** (profil marche)                 | Itinéraires à pied, open source             |
| GPS               | `geolocator` (+ background)              | Position, tracé, sessions en arrière-plan   |
| Compteur de pas   | `pedometer` / HealthKit / Health Connect | Pas pendant une session                     |
| Temps réel        | **Supabase Realtime**                    | Positions live, chat, découvertes           |
| Notifications     | Firebase Cloud Messaging                 | Événements, invitations, rappels            |
| Stockage images   | **Supabase Storage**                     | Photos, points d'intérêt, souvenirs         |

Le détail des choix et des alternatives est dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## 🗓️ Roadmap par phases

Le développement suit les 4 phases du cahier des charges. Le détail est dans
[`docs/ROADMAP.md`](docs/ROADMAP.md).

- **Phase 1 — MVP** _(en cours)_ : groupe privé · carte · GPS · sessions · découverte · tracés
- **Phase 2** : photos · chat · localisation temps réel · campements
- **Phase 3** : Djadja Coins · boutique · missions journalières · compagnon
- **Phase 4** : Contest · objets · Mode Boussole · événements avancés

Le schéma de base de données est conçu **dès maintenant** pour supporter les 4 phases,
mais seule la Phase 1 est implémentée côté application.

## 🚀 Démarrage

> ⚠️ Ce dépôt fournit le **squelette de projet** et le **schéma de données**. Il ne compile pas
> encore une application complète : l'implémentation suit la roadmap ci-dessus.

### 1. Backend (Supabase / PostGIS)

```bash
cd backend/supabase
# Installer le CLI Supabase : https://supabase.com/docs/guides/cli
supabase start              # environnement local (Postgres + PostGIS + Storage)
supabase db reset           # applique les migrations de migrations/
```

Voir [`backend/supabase/README.md`](backend/supabase/README.md).

### 2. Application (Flutter)

```bash
cd app
cp .env.example .env        # renseigner SUPABASE_URL et SUPABASE_ANON_KEY
flutter pub get
flutter run
```

Voir [`app/README.md`](app/README.md).

## 📚 Documentation

| Document                                       | Contenu                                             |
| ---------------------------------------------- | --------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Architecture technique, choix, découpage en couches |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)     | Modèle de données complet (entités, relations)      |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)           | Découpage détaillé des 4 phases                     |
| [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)   | Économie Djadja, Contest, objets, compagnon         |

## 👑 Groupe

Le premier utilisateur devient administrateur. Administrateur initial : **Le Kyk's**.
Les amis rejoignent le groupe via un **lien d'invitation** — pas de recherche publique,
pas de profils publics.

---

<div align="center">
<sub>Chaque balade devient une exploration, un souvenir, une progression, un moment entre amis.</sub>
</div>
