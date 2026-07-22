# Déploiement — Gayeulle Party

Ce guide met en ligne le backend **Supabase Cloud** (gratuit) et connecte l'application.
Aucune donnée sensible (mot de passe, clé) ne doit être committée dans le dépôt.

> Le backend **doit** être Supabase (pas un PostgreSQL nu) : l'app utilise `auth`,
> `storage`, `supabase_realtime` et `auth.uid()`.

---

## 1. Créer le projet Supabase (~5 min)

1. Va sur https://supabase.com → **New project**.
2. **Region** : choisis la plus proche (ex. *Europe (Frankfurt)*).
3. Définis un **Database password** fort (note-le dans un gestionnaire de mots de passe,
   **pas** dans le dépôt).
4. Attends la fin du provisioning (~2 min).

## 2. Récupérer les identifiants

Dans le projet :

- **Project Settings → API**
  - `Project URL`  → ce sera `SUPABASE_URL`
  - `anon` `public` → ce sera `SUPABASE_ANON_KEY`
- **Project Settings → Database → Connection string → URI**
  - Copie l'URI **Session / Direct** (port **5432**). Ce sera `DATABASE_URL` pour appliquer
    les migrations. ⚠️ **Pas** le pooler *transaction* (port 6543).

## 3. Appliquer le schéma (migrations)

Sur ta machine (avec `psql` installé : `sudo apt install postgresql-client`) :

```bash
export DATABASE_URL='postgresql://postgres:TON_MDP_DB@db.<ref>.supabase.co:5432/postgres'
./tools/apply_migrations.sh
```

Le script applique dans l'ordre `0001` → `0011` puis `seed.sql`. Il active PostGIS,
crée les tables, le RLS, les fonctions serveur, les buckets Storage et la publication
Realtime.

> Alternative sans psql : ouvre **SQL Editor** dans Supabase et colle le contenu de
> chaque fichier de `backend/supabase/migrations/` **dans l'ordre**, puis `seed.sql`.

**Vérifie** ensuite :
- **Database → Extensions** : `postgis` est activé.
- **Table Editor** : `profiles`, `groups`, `tracks`, `discovered_zones`, `shop_items`… existent.
- **Database → Publications** : `supabase_realtime` inclut `chat_messages`, `member_presence`,
  `tracks`, `discovered_zones`, `wallets`, `events`, `event_participants`.

## 4. Configurer l'authentification

- **Authentication → Providers → Email** : active l'email. L'app utilise un **code OTP**
  (`signInWithOtp`), donc l'auth par email suffit (pas besoin de mot de passe).
- **Authentication → URL Configuration → Redirect URLs** : ajoute
  ```
  gayeulle://
  ```
  (pour le retour d'OTP et les liens d'invitation `gayeulle://join?token=…`).

## 5. (Storage) Vérifier les buckets

La migration `0008` crée les buckets privés `poi-images`, `chat-images`, `session-photos`
avec des policies par groupe. Vérifie dans **Storage** qu'ils sont présents.

## 6. Connecter l'application

```bash
cd app
cp .env.example .env
```

Édite `app/.env` :

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...   # la clé "anon public"
MAP_STYLE_URL=https://tiles.openfreemap.org/styles/dark
OSRM_BASE_URL=https://router.project-osrm.org
```

Puis génère les projets natifs et lance :

```bash
cd ..
./tools/bootstrap.sh
cd app && flutter run
```

## 7. Test de fumée (premier lancement)

1. **Connexion** : entre ton email → tu reçois un code → connexion.
2. **Groupe** : crée un groupe (tu deviens admin 👑).
3. **Session** : lance une session, marche un peu → un tracé apparaît, une zone se révèle.
4. **Invite un ami** : bouton d'invitation → il ouvre le lien `gayeulle://join?token=…`.

Si quelque chose bloque au build, copie-moi l'erreur `flutter` : c'est surtout l'API
MapLibre qui peut demander un petit ajustement selon la version du package.

---

## Le mot de passe partagé plus tôt

Le mot de passe de ton VPS Contabo a été collé en clair dans la conversation :
**change-le** (`passwd` sur le serveur + panel Contabo), et de préférence passe en **clé SSH**
avec l'auth par mot de passe désactivée. Ce guide n'en a pas besoin (Supabase Cloud n'utilise
pas ton VPS).

## Réutiliser ton VPS Contabo (optionnel, plus tard)

Ton VPS peut héberger les services **open source** que l'app référence, pour ne pas dépendre
d'endpoints publics :

- **OSRM** (itinéraires piéton) — profil `foot`, derrière HTTPS → renseigne `OSRM_BASE_URL`.
- **Tuiles de carte** (OpenMapTiles / serveur de style MapLibre) → `MAP_STYLE_URL`.

C'est du self-host « sans état » (pas de données joueurs), donc beaucoup moins risqué que
d'y mettre la base. On pourra s'en occuper quand l'app tournera.
