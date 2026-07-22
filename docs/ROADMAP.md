# Roadmap — Gayeulle Party

Découpage du développement en 4 phases, repris du cahier des charges. Chaque phase est jouable
et livrable. Le **schéma de base de données** est posé dès la Phase 1 pour supporter les 4 phases
sans migration destructive ; l'**application** implémente les fonctionnalités phase par phase,
pilotées par des feature flags (`core/config/feature_flags.dart`).

Légende : ✅ fait · 🚧 en cours · ⬜ à faire

---

## Phase 1 — MVP (cœur jouable) 🚧

**Objectif : une balade se transforme en tracé sur une carte commune qui se dévoile.**

| # | Fonctionnalité                    | Détail                                                                 | État |
|---|-----------------------------------|------------------------------------------------------------------------|------|
| 1 | Authentification                  | Connexion Supabase (email/OTP), session persistante                    | ⬜   |
| 2 | Groupe privé                      | Création (1er user = admin 👑 Le Kyk's), lien d'invitation, membres    | ⬜   |
| 3 | Carte commune                     | MapLibre, style sombre pixel, brouillard d'exploration                 | ⬜   |
| 4 | Permissions & GPS                 | Localisation « always », service background                            | ⬜   |
| 5 | Session d'exploration             | Start/stop, GPS + pas + distance + durée, veille/écran verrouillé      | ⬜   |
| 6 | Tracé                             | Enregistrement du tracé coloré, propriétaire, longueur PostGIS         | ⬜   |
| 7 | Découverte                        | Buffer autour du tracé → zone révélée commune au groupe                | ⬜   |
| 8 | Résumé de session                 | km · pas · durée · nouvelles zones (photos en Phase 2)                  | ⬜   |

**Livrables techniques Phase 1**
- Schéma SQL Phase 1 (`profiles`, `groups`, `group_members`, `group_invites`,
  `exploration_sessions`, `tracks`, `discovered_zones`) + RLS. ✅ (migrations posées)
- Scaffold Flutter : thème, routing, client Supabase, modèles, services location/pas. ✅
- Écrans : Auth, Groupe (créer/rejoindre), Carte, Session (live + résumé). 🚧

## Phase 2 — Vie du groupe ⬜

**Objectif : le groupe vit sur la carte (se voit, se parle, marque des lieux).**

| # | Fonctionnalité             | Détail                                                             |
|---|----------------------------|-------------------------------------------------------------------|
| 1 | Photos & points d'intérêt  | POI géolocalisés (photo / lieu / souvenir), Supabase Storage      |
| 2 | Chat de groupe             | Texte, photo, position, lieu partagé (Realtime)                   |
| 3 | Localisation temps réel    | Positions live + réglage visibilité (visible/session/invisible)   |
| 4 | Campements                 | Camp personnel (niche compagnon) + camp de groupe (admin)         |

## Phase 3 — Économie & progression ⬜

**Objectif : progresser et se récompenser (sans pay-to-win).**

| # | Fonctionnalité         | Détail                                                                |
|---|------------------------|-----------------------------------------------------------------------|
| 1 | Djadja Coins           | Portefeuille + transactions serveur (crédit/débit atomique)           |
| 2 | Missions journalières  | marcher / explorer / photos / compagnon → récompenses                 |
| 3 | Boutique               | Cosmétique uniquement : skins, vêtements, compagnons, camps, effets   |
| 4 | Compagnon              | Niche, sortie **1×/jour**, révèle ~100 m, revient dormir              |

## Phase 4 — Contest & événements ⬜

**Objectif : la compétition et les événements pilotés par l'admin.**

| # | Fonctionnalité         | Détail                                                                     |
|---|------------------------|----------------------------------------------------------------------------|
| 1 | Événements admin       | Contest, Contest Boussole, expéditions (créés par l'admin)                 |
| 2 | Mode Contest           | Récupération de tracé adverse en passant dessus, scoring                    |
| 3 | Objets Contest         | Bombe, Pinceau, Rouleau, Bouclier (chers → équilibre)                       |
| 4 | Mode Boussole          | Flèche + direction + distance, **sans carte** (événement uniquement)       |
| 5 | Contest Boussole       | Contest + Boussole : carte cachée, navigation flèche, récupération, objets  |

---

## Principes transverses (toutes phases)

- **Privé d'abord** : aucune donnée publique, tout est cloisonné par groupe (RLS).
- **Marche uniquement** : progression et navigation supposent un profil piéton.
- **Serveur autoritaire** : économie et Contest résolus côté serveur (anti-triche).
- **Open source d'abord** : MapLibre, OpenStreetMap, OSRM, PostGIS.
- **Direction artistique** : pixel art HD, carte sombre, néon/rétro-futuriste, monde vivant.

## État actuel du dépôt

Ce dépôt fournit aujourd'hui :

- la **documentation** (architecture, modèle de données, roadmap, game design) ;
- le **schéma de base de données** PostGIS des Phases 1→4 (migrations Supabase) ;
- le **scaffold Flutter** (thème, config, routing, modèles, services, écrans Phase 1 en cours).

Prochaine étape : compléter l'implémentation des écrans Phase 1 et brancher les services GPS/pas
sur l'enregistrement des tracés vers Supabase.
