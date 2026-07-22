# Modèle de données — Gayeulle Party

Modèle de données complet, conçu pour supporter les **4 phases** dès le départ. Le schéma SQL
correspondant est versionné dans [`backend/supabase/migrations/`](../backend/supabase/migrations/).

Toutes les géométries utilisent **PostGIS**, SRID **4326** (WGS84), en type `geography` pour des
calculs métriques directs (mètres) sur l'ellipsoïde.

---

## Diagramme relationnel (résumé)

```
auth.users (Supabase)
    │ 1—1
    ▼
profiles ──────────┐
    │ 1—N          │ N—N via group_members
    ▼              ▼
  (auteur)       groups ── 1—N ── group_invites
                   │
     ┌─────────────┼───────────────┬───────────────┬──────────────┐
     ▼             ▼               ▼               ▼              ▼
exploration_    tracks       discovered_      points_of_     chat_messages
 sessions     (LineString)     zones          interest        (Phase 2)
     │         (Phase 1)     (Polygon)        (Point, P2)
     │ 1—N                    (Phase 1)
     ▼
 session_photos (P2)

Phase 3 :  wallets ── wallet_transactions      shop_items ── inventory
           daily_missions ── mission_progress   companions ── companion_runs
           camps

Phase 4 :  events ── event_participants        contest_items ── contest_actions
```

---

## Phase 1 — Cœur jouable

### `profiles`
Profil de jeu lié à un compte Supabase Auth.

| Colonne         | Type                          | Notes                                             |
| --------------- | ----------------------------- | ------------------------------------------------- |
| `id`            | `uuid` PK                     | = `auth.users.id`                                 |
| `display_name`  | `text`                        | pseudo affiché (ex. « Le Kyk's »)                 |
| `avatar_key`    | `text`                        | clé du skin d'avatar courant                      |
| `color`         | `text`                        | couleur du joueur (hex), pour tracés & avatar     |
| `created_at`    | `timestamptz`                 |                                                   |

### `groups`
Le groupe privé. Créé par le premier utilisateur, qui en devient l'administrateur.

| Colonne         | Type          | Notes                                              |
| --------------- | ------------- | -------------------------------------------------- |
| `id`            | `uuid` PK     |                                                    |
| `name`          | `text`        | nom du groupe                                      |
| `owner_id`      | `uuid` FK     | → `profiles.id` (l'administrateur, 👑 Le Kyk's)    |
| `created_at`    | `timestamptz` |                                                    |

### `group_members`
Appartenance N—N joueurs/groupes + rôle. **Table pivot centrale du RLS.**

| Colonne     | Type                              | Notes                                |
| ----------- | --------------------------------- | ------------------------------------ |
| `group_id`  | `uuid` FK → `groups.id`           | PK composite                         |
| `user_id`   | `uuid` FK → `profiles.id`         | PK composite                         |
| `role`      | `member_role` (`admin`/`member`)  | l'admin peut créer des événements    |
| `joined_at` | `timestamptz`                     |                                      |

### `group_invites`
Liens d'invitation (pas de recherche publique).

| Colonne       | Type          | Notes                                     |
| ------------- | ------------- | ----------------------------------------- |
| `id`          | `uuid` PK     |                                           |
| `group_id`    | `uuid` FK     |                                           |
| `token`       | `text` unique | jeton du lien `gayeulle://join?token=…`   |
| `created_by`  | `uuid` FK     |                                           |
| `expires_at`  | `timestamptz` | nullable                                  |
| `max_uses`    | `int`         | nullable ; `use_count` suit l'usage       |
| `use_count`   | `int`         | défaut 0                                   |

### `exploration_sessions`
Une session de marche (« Commencer une session »).

| Colonne         | Type                        | Notes                                        |
| --------------- | --------------------------- | -------------------------------------------- |
| `id`            | `uuid` PK                   |                                              |
| `group_id`      | `uuid` FK                   |                                              |
| `user_id`       | `uuid` FK                   | auteur                                       |
| `started_at`    | `timestamptz`               |                                              |
| `ended_at`      | `timestamptz`               | nullable tant que la session est active      |
| `distance_m`    | `double precision`          | distance parcourue (mètres)                  |
| `steps`         | `int`                       | pas comptés                                  |
| `duration_s`    | `int`                       | durée (secondes)                             |
| `status`        | `session_status`            | `active` / `finished` / `discarded`          |

### `tracks`
Le **tracé** d'une session : ligne géographique appartenant à un joueur. Cœur de la carte.

| Colonne         | Type                              | Notes                                       |
| --------------- | --------------------------------- | ------------------------------------------- |
| `id`            | `uuid` PK                         |                                             |
| `session_id`    | `uuid` FK → `exploration_sessions`|                                             |
| `group_id`      | `uuid` FK                         | dénormalisé pour le RLS/les requêtes carte  |
| `user_id`       | `uuid` FK                         | **propriétaire du tracé**                   |
| `geom`          | `geography(LineString,4326)`      | la polyligne GPS                            |
| `color`         | `text`                            | couleur (copie de la couleur du joueur)     |
| `length_m`      | `double precision`                | longueur (mètres), calculée                 |
| `created_at`    | `timestamptz`                     |                                             |

> En **Contest**, un tracé peut être partiellement récupéré/détruit : le `geom` peut donc être
> découpé (`ST_Difference`) ou changer de propriétaire sur une portion. Voir Phase 4.

### `discovered_zones`
Les **zones découvertes** qui percent le brouillard d'exploration, communes au groupe.

| Colonne         | Type                                | Notes                                      |
| --------------- | ----------------------------------- | ------------------------------------------ |
| `id`            | `uuid` PK                           |                                            |
| `group_id`      | `uuid` FK                           | zone commune au groupe                     |
| `discovered_by` | `uuid` FK                           | premier à révéler cette zone               |
| `geom`          | `geography(MultiPolygon,4326)`      | buffer autour des tracés (ex. rayon ~50 m) |
| `area_m2`       | `double precision`                  | superficie révélée                         |
| `source`        | `zone_source`                       | `session` / `companion` / `contest`        |
| `created_at`    | `timestamptz`                       |                                            |

> Stratégie : à la fin d'une session, on calcule un buffer autour du tracé, on l'`ST_Union` avec
> les zones existantes du groupe. Alternative servie côté carte : agrégation en tuiles.

---

## Phase 2 — Vie du groupe

### `points_of_interest`
Photos, points d'intérêt, souvenirs géolocalisés.

| Colonne       | Type                     | Notes                              |
| ------------- | ------------------------ | ---------------------------------- |
| `id`          | `uuid` PK                |                                    |
| `group_id`    | `uuid` FK                |                                    |
| `author_id`   | `uuid` FK                | auteur                             |
| `kind`        | `poi_kind`               | `photo` / `place` / `memory`       |
| `title`       | `text`                   | nullable                           |
| `geom`        | `geography(Point,4326)`  | position                           |
| `created_at`  | `timestamptz`            |                                    |

### `poi_images` / `session_photos`
Images rattachées à un POI ou une session (clé Supabase Storage).

| Colonne       | Type          | Notes                                  |
| ------------- | ------------- | -------------------------------------- |
| `id`          | `uuid` PK     |                                        |
| `poi_id`      | `uuid` FK     | (ou `session_id` pour session_photos)  |
| `storage_path`| `text`        | chemin dans le bucket Storage          |
| `created_at`  | `timestamptz` |                                        |

### `chat_messages`
Chat privé du groupe (texte, photo, position, lieu partagé).

| Colonne       | Type            | Notes                                          |
| ------------- | --------------- | ---------------------------------------------- |
| `id`          | `uuid` PK       |                                                |
| `group_id`    | `uuid` FK       |                                                |
| `author_id`   | `uuid` FK       |                                                |
| `kind`        | `message_kind`  | `text` / `photo` / `location` / `poi`          |
| `body`        | `text`          | contenu texte / légende                        |
| `geom`        | `geography(Point,4326)` | pour `kind=location`                   |
| `poi_id`      | `uuid` FK       | pour `kind=poi`                                |
| `created_at`  | `timestamptz`   |                                                |

### `member_presence`
Position live + réglage de visibilité (localisation temps réel).

| Colonne        | Type                       | Notes                                          |
| -------------- | -------------------------- | ---------------------------------------------- |
| `group_id`     | `uuid` FK                  | PK composite                                   |
| `user_id`      | `uuid` FK                  | PK composite                                   |
| `geom`         | `geography(Point,4326)`    | dernière position connue                       |
| `heading`      | `double precision`         | direction (degrés)                             |
| `visibility`   | `presence_visibility`      | `visible` / `session_only` / `invisible`       |
| `updated_at`   | `timestamptz`              |                                                |

> Les positions haute-fréquence transitent de préférence par un canal Realtime « broadcast ».
> `member_presence` conserve la dernière position et le réglage de visibilité.

### `camps`
Campements. Camp personnel = niche du compagnon ; camp de groupe = créé par l'admin.

| Colonne       | Type                     | Notes                                     |
| ------------- | ------------------------ | ----------------------------------------- |
| `id`          | `uuid` PK                |                                           |
| `group_id`    | `uuid` FK                |                                           |
| `owner_id`    | `uuid` FK                | nullable (null = camp de groupe)          |
| `kind`        | `camp_kind`              | `personal` / `group`                      |
| `name`        | `text`                   |                                           |
| `geom`        | `geography(Point,4326)`  | emplacement                               |
| `created_at`  | `timestamptz`            |                                           |

---

## Phase 3 — Économie & progression

### `wallets` / `wallet_transactions`
Portefeuille de **Djadja Coins** par joueur (et par groupe) + journal des mouvements.

| `wallets`     | Type       | Notes                          |
| ------------- | ---------- | ------------------------------ |
| `user_id`     | `uuid` FK  | PK composite                   |
| `group_id`    | `uuid` FK  | PK composite                   |
| `balance`     | `bigint`   | solde de Djadja Coins (≥ 0)    |

| `wallet_transactions` | Type            | Notes                                  |
| --------------------- | --------------- | -------------------------------------- |
| `id`                  | `uuid` PK       |                                        |
| `user_id`/`group_id`  | `uuid` FK       |                                        |
| `amount`              | `bigint`        | positif (crédit) / négatif (débit)     |
| `reason`              | `txn_reason`    | `mission` / `purchase` / `contest`/…   |
| `ref_id`              | `uuid`          | référence (mission, item, action…)     |
| `created_at`          | `timestamptz`   |                                        |

> Les crédits/débits passent **exclusivement** par une fonction serveur (`SECURITY DEFINER`)
> qui vérifie le solde et écrit atomiquement wallet + transaction.

### `shop_items` / `inventory`
Boutique **100 % cosmétique** (pas de pay-to-win) + inventaire du joueur.

| `shop_items`  | Type          | Notes                                                     |
| ------------- | ------------- | --------------------------------------------------------- |
| `id`          | `uuid` PK     |                                                           |
| `category`    | `item_category` | `avatar_skin`/`clothing`/`companion`/`camp`/`map`/`trail`/`effect` |
| `name`        | `text`        |                                                           |
| `price`       | `bigint`      | prix en Djadja Coins                                      |
| `metadata`    | `jsonb`       | assets, rareté, aperçu                                    |

| `inventory`   | Type          | Notes                              |
| ------------- | ------------- | ---------------------------------- |
| `user_id`     | `uuid` FK     | PK composite                       |
| `item_id`     | `uuid` FK     | PK composite                       |
| `equipped`    | `boolean`     | équipé ou non                      |
| `acquired_at` | `timestamptz` |                                    |

### `daily_missions` / `mission_progress`
Missions journalières récompensées en Djadja Coins.

| `daily_missions`  | Type            | Notes                                             |
| ----------------- | --------------- | ------------------------------------------------- |
| `id`              | `uuid` PK       |                                                   |
| `code`            | `text`          | ex. `walk_2km`, `take_photo`, `use_companion`     |
| `goal`            | `int`           | objectif (ex. 2000 m, 1 photo)                    |
| `reward`          | `bigint`        | Djadja Coins gagnés                               |
| `for_date`        | `date`          | jour de validité                                  |

| `mission_progress`| Type            | Notes                                     |
| ----------------- | --------------- | ----------------------------------------- |
| `user_id`         | `uuid` FK       | PK composite                              |
| `mission_id`      | `uuid` FK       | PK composite                              |
| `progress`        | `int`           | avancement courant                        |
| `completed_at`    | `timestamptz`   | nullable                                  |
| `claimed`         | `boolean`       | récompense réclamée                       |

### `companions` / `companion_runs`
Le compagnon de chaque joueur + ses sorties quotidiennes.

| `companions`  | Type                     | Notes                                       |
| ------------- | ------------------------ | ------------------------------------------- |
| `id`          | `uuid` PK                |                                             |
| `user_id`     | `uuid` FK                | propriétaire                                |
| `group_id`    | `uuid` FK                |                                             |
| `species`     | `text`                   | type/skin de compagnon                      |
| `den_geom`    | `geography(Point,4326)`  | emplacement de la niche                     |

| `companion_runs`| Type                          | Notes                                             |
| --------------- | ----------------------------- | ------------------------------------------------- |
| `id`            | `uuid` PK                     |                                                   |
| `companion_id`  | `uuid` FK                     |                                                   |
| `run_date`      | `date`                        | **une sortie par jour** (unique par compagnon)    |
| `revealed_geom` | `geography(Polygon,4326)`     | zone révélée (~100 m)                              |

> Contrainte d'unicité `(companion_id, run_date)` : le compagnon ne sort qu'une fois par jour.

---

## Phase 4 — Contest, objets, événements

### `events` / `event_participants`
Événements créés par l'administrateur : Contest, Contest Boussole, expéditions.

| `events`      | Type            | Notes                                                    |
| ------------- | --------------- | -------------------------------------------------------- |
| `id`          | `uuid` PK       |                                                          |
| `group_id`    | `uuid` FK       |                                                          |
| `created_by`  | `uuid` FK       | doit être `admin` du groupe                              |
| `kind`        | `event_kind`    | `contest` / `contest_compass` / `expedition`             |
| `status`      | `event_status`  | `scheduled` / `active` / `ended`                         |
| `starts_at` / `ends_at` | `timestamptz` |                                                  |
| `rules`       | `jsonb`         | paramètres (objets autorisés, zone, etc.)                |

| `event_participants` | Type       | Notes                       |
| -------------------- | ---------- | --------------------------- |
| `event_id`           | `uuid` FK  | PK composite                |
| `user_id`            | `uuid` FK  | PK composite                |
| `score`              | `bigint`   | score courant               |

### `contest_items` / `contest_actions`
Catalogue d'objets Contest + actions jouées.

Objets (voir [`GAME_DESIGN.md`](GAME_DESIGN.md)) :

| Objet      | Effet                                            |
| ---------- | ------------------------------------------------ |
| **Bombe**  | Détruit une partie du tracé ennemi               |
| **Pinceau**| Récupère une partie du tracé adverse             |
| **Rouleau**| Capture une zone plus grande                     |
| **Bouclier**| Protège une zone                                |

| `contest_actions` | Type                     | Notes                                          |
| ----------------- | ------------------------ | ---------------------------------------------- |
| `id`              | `uuid` PK                |                                                |
| `event_id`        | `uuid` FK                |                                                |
| `actor_id`        | `uuid` FK                | joueur qui agit                                |
| `item_code`       | `text`                   | `bomb`/`brush`/`roller`/`shield`               |
| `target_track_id` | `uuid` FK                | tracé ciblé (nullable pour rouleau/bouclier)   |
| `geom`            | `geography(Geometry,4326)` | zone d'effet                                 |
| `resolved`        | `boolean`                | traité côté serveur                            |
| `created_at`      | `timestamptz`            |                                                |

> **Récupération de tracé** : en mode normal, passer sur le tracé d'un ami ne récupère rien.
> En **Contest**, passer sur (ou cibler avec le pinceau) le tracé d'un autre joueur transfère
> cette portion. La résolution (découpe `ST_Difference` / `ST_Split`, réattribution) est faite
> côté serveur pour éviter la triche.

---

## Types énumérés (résumé)

```
member_role          = admin | member
session_status       = active | finished | discarded
zone_source          = session | companion | contest
poi_kind             = photo | place | memory
message_kind         = text | photo | location | poi
presence_visibility  = visible | session_only | invisible
camp_kind            = personal | group
txn_reason           = mission | purchase | contest | companion | admin_grant | refund
item_category        = avatar_skin | clothing | companion | camp | map | trail | effect
event_kind           = contest | contest_compass | expedition
event_status         = scheduled | active | ended
```

## Index géographiques

Chaque colonne `geography` porte un index **GiST** (`CREATE INDEX … USING gist (geom)`), et les
colonnes `group_id` un index B-tree, pour les requêtes carte et les tests de proximité Contest.
