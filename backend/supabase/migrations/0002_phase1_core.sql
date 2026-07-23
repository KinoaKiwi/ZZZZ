-- ============================================================================
-- Gayeulle Party — 0002 : Phase 1 — schéma cœur
-- profils, groupes, membres, invitations, sessions, tracés, zones découvertes
-- ============================================================================

-- --- profiles ----------------------------------------------------------------
-- Profil de jeu, lié 1—1 à un compte Supabase Auth (auth.users).
create table if not exists profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null,
  avatar_key    text not null default 'default',
  color         text not null default '#6EE7F0',   -- couleur du joueur (hex)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated on profiles;
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- Création automatique du profil à l'inscription.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- --- groups ------------------------------------------------------------------
-- Groupe privé. Le premier utilisateur (créateur) en est l'administrateur.
create table if not exists groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_groups_updated on groups;
create trigger trg_groups_updated before update on groups
  for each row execute function set_updated_at();

-- --- group_members -----------------------------------------------------------
-- Table pivot N—N joueurs/groupes + rôle. Pilote toute la sécurité (RLS).
create table if not exists group_members (
  group_id   uuid not null references groups (id) on delete cascade,
  user_id    uuid not null references profiles (id) on delete cascade,
  role       member_role not null default 'member',
  joined_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists idx_group_members_user on group_members (user_id);

-- --- group_invites -----------------------------------------------------------
-- Liens d'invitation (aucune recherche publique). Jeton porté par un lien.
create table if not exists group_invites (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups (id) on delete cascade,
  token       text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_by  uuid not null references profiles (id) on delete cascade,
  expires_at  timestamptz,
  max_uses    int,
  use_count   int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_group_invites_group on group_invites (group_id);

-- --- exploration_sessions ----------------------------------------------------
-- Une session de marche (« Commencer une session »).
create table if not exists exploration_sessions (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references groups (id) on delete cascade,
  user_id      uuid not null references profiles (id) on delete cascade,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  distance_m   double precision not null default 0,
  steps        int not null default 0,
  duration_s   int not null default 0,
  status       session_status not null default 'active',
  created_at   timestamptz not null default now()
);

create index if not exists idx_sessions_group on exploration_sessions (group_id);
create index if not exists idx_sessions_user  on exploration_sessions (user_id);

-- --- tracks ------------------------------------------------------------------
-- Le tracé d'une session : polyligne géographique appartenant à un joueur.
create table if not exists tracks (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references exploration_sessions (id) on delete cascade,
  group_id    uuid not null references groups (id) on delete cascade,   -- dénormalisé (RLS / carte)
  user_id     uuid not null references profiles (id) on delete cascade, -- propriétaire du tracé
  geom        geography(LineString, 4326) not null,
  color       text not null default '#6EE7F0',
  length_m    double precision not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_tracks_group on tracks (group_id);
create index if not exists idx_tracks_user  on tracks (user_id);
create index if not exists idx_tracks_geom  on tracks using gist (geom);

-- Calcule automatiquement la longueur (mètres) à l'insertion / mise à jour du geom.
create or replace function tracks_set_length()
returns trigger
language plpgsql
as $$
begin
  new.length_m := coalesce(ST_Length(new.geom), 0);
  return new;
end;
$$;

drop trigger if exists trg_tracks_length on tracks;
create trigger trg_tracks_length before insert or update of geom on tracks
  for each row execute function tracks_set_length();

-- --- discovered_zones --------------------------------------------------------
-- Zones découvertes qui percent le brouillard d'exploration, communes au groupe.
create table if not exists discovered_zones (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references groups (id) on delete cascade,
  discovered_by  uuid references profiles (id) on delete set null,
  geom           geography(MultiPolygon, 4326) not null,
  area_m2        double precision not null default 0,
  source         zone_source not null default 'session',
  created_at     timestamptz not null default now()
);

create index if not exists idx_zones_group on discovered_zones (group_id);
create index if not exists idx_zones_geom  on discovered_zones using gist (geom);

create or replace function zones_set_area()
returns trigger
language plpgsql
as $$
begin
  new.area_m2 := coalesce(ST_Area(new.geom), 0);
  return new;
end;
$$;

drop trigger if exists trg_zones_area on discovered_zones;
create trigger trg_zones_area before insert or update of geom on discovered_zones
  for each row execute function zones_set_area();
