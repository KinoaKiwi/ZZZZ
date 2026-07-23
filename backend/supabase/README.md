# Backend Supabase — Gayeulle Party

Base de données **PostgreSQL + PostGIS** et services Supabase (Auth, Storage, Realtime).

## Prérequis

- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Docker (pour l'environnement local `supabase start`)

## Démarrage local

```bash
cd backend/supabase
supabase start            # démarre Postgres+PostGIS, Auth, Storage, Realtime en local
supabase db reset         # applique migrations/ puis seed.sql
```

`supabase start` affiche l'`API URL` et l'`anon key` à reporter dans `app/.env`.

## Migrations

Les migrations sont appliquées dans l'ordre lexicographique des fichiers de `migrations/` :

| Fichier                                | Contenu                                                    |
| -------------------------------------- | ---------------------------------------------------------- |
| `0001_extensions_and_enums.sql`        | extensions (PostGIS, pgcrypto), types énumérés, helper     |
| `0002_phase1_core.sql`                 | profils, groupes, membres, invitations, sessions, tracés, zones |
| `0003_phase1_rls.sql`                  | RLS Phase 1 + RPC `create_group` / `join_group_with_token` |
| `0004_phase1_discovery.sql`            | découverte : buffer de tracé → zone, `finish_session`      |
| `0005_phase2_group_life.sql`           | POI/photos, chat, présence, campements + RLS               |
| `0006_phase3_economy.sql`              | Djadja Coins, boutique, missions, compagnon + RLS + RPC    |
| `0007_phase4_contest.sql`              | événements, objets & actions Contest + RLS                 |

> Le schéma des **4 phases** est posé dès maintenant ; l'application n'active les
> fonctionnalités que phase par phase (feature flags).

### Créer une nouvelle migration

```bash
supabase migration new <nom_explicite>
# éditez le fichier généré dans migrations/, puis :
supabase db reset
```

## Sécurité (RLS)

- Toutes les tables de jeu ont le **Row Level Security activé**.
- Règle d'or : _un membre ne voit que les données des groupes auxquels il appartient_
  (vérifié via `is_group_member(group_id)` / `is_group_admin(group_id)`).
- L'économie (Djadja Coins) et le Contest sont **résolus côté serveur**
  (fonctions `SECURITY DEFINER`), jamais par des écritures directes du client.

## Storage

Créer les buckets (privés) pour les images, avec des policies alignées sur le RLS :

- `poi-images` — images des points d'intérêt ;
- `session-photos` — photos de session ;
- `avatars` — skins/cosmétiques éventuels.

## Realtime

Activer la réplication Realtime sur les tables diffusées :
`discovered_zones`, `tracks`, `chat_messages`, `member_presence`, `events`.
Les positions live haute-fréquence peuvent passer par un canal **broadcast** (non persistant).
