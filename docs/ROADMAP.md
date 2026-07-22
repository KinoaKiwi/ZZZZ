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
| 1 | Authentification                  | Connexion Supabase (email/OTP), session persistante                    | ✅   |
| 2 | Groupe privé                      | Création (1er user = admin 👑 Le Kyk's), lien d'invitation, membres    | ✅   |
| 3 | Carte commune                     | MapLibre, style sombre, brouillard, zones & tracés chargés             | ✅   |
| 4 | Permissions & GPS                 | Localisation « always », foreground service Android / background iOS   | ✅   |
| 5 | Session d'exploration             | Start/stop, GPS + pas + distance + durée, veille/écran verrouillé      | ✅   |
| 6 | Tracé                             | Enregistrement du tracé coloré, propriétaire, longueur PostGIS         | ✅   |
| 7 | Découverte                        | Buffer autour du tracé → zone révélée commune au groupe                | ✅   |
| 8 | Résumé de session                 | km · pas · durée · nouvelles zones (photos en Phase 2)                  | ✅   |
| 9 | Deep link d'invitation            | `gayeulle://join?token=…` → adhésion automatique                       | ✅   |

**Livrables techniques Phase 1**
- Schéma SQL Phase 1 (`profiles`, `groups`, `group_members`, `group_invites`,
  `exploration_sessions`, `tracks`, `discovered_zones`) + RLS. ✅
- Scaffold Flutter : thème, routing, client Supabase, modèles, services location/pas. ✅
- Écrans : Auth, Groupe (créer/rejoindre), Carte, Session (live + résumé). ✅
- Config native (permissions, background location, deep links) via `tools/bootstrap.sh`. ✅
- Suivi GPS en arrière-plan (foreground service Android + background mode iOS). ✅

> **Code-complete, à valider sur appareil.** L'app n'a pas pu être compilée/testée
> dans l'environnement de génération (pas de SDK Flutter). Lancer `tools/bootstrap.sh`
> sur une machine avec Flutter, puis `flutter run`, et valider sur un téléphone réel
> (permissions, précision GPS, comptage de pas, rendu de carte).

## Phase 2 — Vie du groupe 🚧 (code-complete)

**Objectif : le groupe vit sur la carte (se voit, se parle, marque des lieux).**

| # | Fonctionnalité             | Détail                                                             | État |
|---|----------------------------|--------------------------------------------------------------------|------|
| 1 | Photos & points d'intérêt  | POI géolocalisés (photo / lieu / souvenir), Supabase Storage, appui long carte | ✅ |
| 2 | Chat de groupe             | Texte, photo, position, lieu partagé — temps réel (Realtime)       | ✅ |
| 3 | Localisation temps réel    | Positions live pendant session + réglage visibilité (3 modes)      | ✅ |
| 4 | Campements                 | Camp personnel (niche compagnon) + camp de groupe (admin), appui long | ✅ |
| 5 | Photos de session          | Ajout de photos souvenirs depuis le résumé de session              | ✅ |
| 6 | Carte vivante              | Recharge auto quand un ami révèle une zone (Realtime)              | ✅ |

**Livrables techniques Phase 2**
- Migrations `0008` (buckets Storage + policies par groupe) et `0009` (lat/lng
  générés + publication Realtime). ✅
- Repositories : POI, chat, présence, camps + providers temps réel. ✅
- Écrans/UI : chat complet, fiche POI (caméra/galerie), fiche camp, réglage
  visibilité, amis en direct sur la carte. ✅
- Publication de position pendant les sessions (throttlée, respecte la visibilité). ✅

> Comme la Phase 1 : **à valider sur appareil** (pas de SDK Flutter dans
> l'environnement de génération).

## Phase 3 — Économie & progression 🚧 (code-complete)

**Objectif : progresser et se récompenser (sans pay-to-win).**

| # | Fonctionnalité         | Détail                                                                | État |
|---|------------------------|-----------------------------------------------------------------------|------|
| 1 | Djadja Coins           | Portefeuille + transactions serveur (crédit/débit atomique), solde live | ✅ |
| 2 | Missions journalières  | marcher / explorer / photos / compagnon → avancement auto + réclamation | ✅ |
| 3 | Boutique               | Cosmétique uniquement : skins, vêtements, compagnons, camps, effets   | ✅ |
| 4 | Compagnon              | Adoption, niche, sortie **1×/jour**, révèle ~100 m, bonus de coins    | ✅ |

**Livrables techniques Phase 3**
- Migration `0010` : `ensure_daily_missions`, `record_activity`, `claim_mission`,
  `get_or_create_companion`, `companion_daily_run` (toutes `SECURITY DEFINER`). ✅
- Repositories : economy (solde live + activités), shop, missions, companion. ✅
- Écrans : missions (barres d'avancement + réclamation), boutique (par catégorie),
  compagnon (adoption + sortie quotidienne), pastille de coins + hub sur la carte. ✅
- Avancement des missions branché : marche & exploration (fin de session),
  photos (POI/session), compagnon (sortie). ✅

> Économie **autoritaire côté serveur** (anti-triche) ; boutique **100 % cosmétique**
> (pas de pay-to-win). À valider sur appareil comme les phases précédentes.

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
