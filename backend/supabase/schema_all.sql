-- ============================================================================
-- Gayeulle Party — SCHÉMA COMPLET (généré : toutes les migrations + seed)
-- À coller dans Supabase → SQL Editor → New query → Run.
-- Ne pas éditer à la main : régénéré depuis migrations/*.sql + seed.sql
-- ============================================================================


-- ####################################################################
-- ## 0001_extensions_and_enums.sql
-- ####################################################################

-- ============================================================================
-- Gayeulle Party — 0001 : extensions & types énumérés
-- ============================================================================
-- Base : PostgreSQL + PostGIS. Toutes les géométries sont en geography(SRID 4326)
-- pour des calculs métriques directs (mètres / m²) sur l'ellipsoïde.
-- ============================================================================

-- --- Extensions --------------------------------------------------------------
create extension if not exists "postgis";
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- --- Types énumérés ----------------------------------------------------------
-- (Idempotence : on encapsule chaque create type pour pouvoir rejouer le fichier.)

do $$ begin
  create type member_role as enum ('admin', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type session_status as enum ('active', 'finished', 'discarded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type zone_source as enum ('session', 'companion', 'contest');
exception when duplicate_object then null; end $$;

do $$ begin
  create type poi_kind as enum ('photo', 'place', 'memory');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_kind as enum ('text', 'photo', 'location', 'poi');
exception when duplicate_object then null; end $$;

do $$ begin
  create type presence_visibility as enum ('visible', 'session_only', 'invisible');
exception when duplicate_object then null; end $$;

do $$ begin
  create type camp_kind as enum ('personal', 'group');
exception when duplicate_object then null; end $$;

do $$ begin
  create type txn_reason as enum ('mission', 'purchase', 'contest', 'companion', 'admin_grant', 'refund');
exception when duplicate_object then null; end $$;

do $$ begin
  create type item_category as enum ('avatar_skin', 'clothing', 'companion', 'camp', 'map', 'trail', 'effect');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_kind as enum ('contest', 'contest_compass', 'expedition');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_status as enum ('scheduled', 'active', 'ended');
exception when duplicate_object then null; end $$;

-- --- Helper : mise à jour automatique de updated_at --------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ####################################################################
-- ## 0002_phase1_core.sql
-- ####################################################################

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

-- ####################################################################
-- ## 0003_phase1_rls.sql
-- ####################################################################

-- ============================================================================
-- Gayeulle Party — 0003 : Phase 1 — sécurité (RLS) & RPC de groupe
-- ============================================================================
-- Règle d'or : un membre ne voit et n'écrit que les données des groupes
-- auxquels il appartient. Rien n'est public.
-- ============================================================================

-- --- Helpers d'appartenance (SECURITY DEFINER pour éviter la récursion RLS) ---
create or replace function is_group_member(gid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

create or replace function is_group_admin(gid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from group_members
    where group_id = gid and user_id = auth.uid() and role = 'admin'
  );
$$;

-- --- Activation du RLS -------------------------------------------------------
alter table profiles              enable row level security;
alter table groups                enable row level security;
alter table group_members         enable row level security;
alter table group_invites         enable row level security;
alter table exploration_sessions  enable row level security;
alter table tracks                enable row level security;
alter table discovered_zones      enable row level security;

-- --- profiles ----------------------------------------------------------------
-- On voit son propre profil et celui des membres d'un groupe partagé.
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1
      from group_members gm_self
      join group_members gm_other on gm_other.group_id = gm_self.group_id
      where gm_self.user_id = auth.uid() and gm_other.user_id = profiles.id
    )
  );

drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Le profil est créé par trigger (handle_new_user) ; on autorise aussi l'upsert self.
drop policy if exists profiles_insert on profiles;
create policy profiles_insert on profiles for insert
  with check (id = auth.uid());

-- --- groups ------------------------------------------------------------------
drop policy if exists groups_select on groups;
create policy groups_select on groups for select
  using (is_group_member(id));

-- Création via RPC (create_group) ; l'insert direct est réservé au créateur.
drop policy if exists groups_insert on groups;
create policy groups_insert on groups for insert
  with check (owner_id = auth.uid());

drop policy if exists groups_update on groups;
create policy groups_update on groups for update
  using (is_group_admin(id)) with check (is_group_admin(id));

-- --- group_members -----------------------------------------------------------
drop policy if exists group_members_select on group_members;
create policy group_members_select on group_members for select
  using (is_group_member(group_id));

-- L'admin peut retirer un membre ; un membre peut se retirer lui-même.
drop policy if exists group_members_delete on group_members;
create policy group_members_delete on group_members for delete
  using (is_group_admin(group_id) or user_id = auth.uid());

-- Les insertions passent par les RPC (create_group / join_group_with_token)
-- exécutées en SECURITY DEFINER : pas de policy d'insert directe côté client.

-- --- group_invites -----------------------------------------------------------
drop policy if exists group_invites_select on group_invites;
create policy group_invites_select on group_invites for select
  using (is_group_member(group_id));

drop policy if exists group_invites_insert on group_invites;
create policy group_invites_insert on group_invites for insert
  with check (is_group_admin(group_id) and created_by = auth.uid());

drop policy if exists group_invites_delete on group_invites;
create policy group_invites_delete on group_invites for delete
  using (is_group_admin(group_id));

-- --- exploration_sessions ----------------------------------------------------
drop policy if exists sessions_select on exploration_sessions;
create policy sessions_select on exploration_sessions for select
  using (is_group_member(group_id));

drop policy if exists sessions_insert on exploration_sessions;
create policy sessions_insert on exploration_sessions for insert
  with check (user_id = auth.uid() and is_group_member(group_id));

drop policy if exists sessions_update on exploration_sessions;
create policy sessions_update on exploration_sessions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- --- tracks ------------------------------------------------------------------
-- Tout le groupe voit les tracés ; seul le propriétaire crée les siens.
drop policy if exists tracks_select on tracks;
create policy tracks_select on tracks for select
  using (is_group_member(group_id));

drop policy if exists tracks_insert on tracks;
create policy tracks_insert on tracks for insert
  with check (user_id = auth.uid() and is_group_member(group_id));

-- Mise à jour de tracé réservée au propriétaire (hors résolution Contest serveur).
drop policy if exists tracks_update on tracks;
create policy tracks_update on tracks for update
  using (user_id = auth.uid()) with check (is_group_member(group_id));

-- --- discovered_zones --------------------------------------------------------
-- Communes au groupe : lecture par tout le groupe, écriture par tout membre.
drop policy if exists zones_select on discovered_zones;
create policy zones_select on discovered_zones for select
  using (is_group_member(group_id));

drop policy if exists zones_insert on discovered_zones;
create policy zones_insert on discovered_zones for insert
  with check (is_group_member(group_id));

drop policy if exists zones_update on discovered_zones;
create policy zones_update on discovered_zones for update
  using (is_group_member(group_id)) with check (is_group_member(group_id));

-- ============================================================================
-- RPC : création & adhésion de groupe (atomiques, SECURITY DEFINER)
-- ============================================================================

-- Crée un groupe et fait du créateur son administrateur (👑).
create or replace function create_group(p_name text)
returns groups
language plpgsql security definer set search_path = public
as $$
declare
  v_group groups;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into groups (name, owner_id)
  values (p_name, auth.uid())
  returning * into v_group;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'admin');

  return v_group;
end;
$$;

-- Rejoint un groupe via un jeton d'invitation (lien). Vérifie expiration & quota.
create or replace function join_group_with_token(p_token text)
returns groups
language plpgsql security definer set search_path = public
as $$
declare
  v_invite group_invites;
  v_group  groups;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from group_invites where token = p_token for update;
  if not found then
    raise exception 'Invalid invite token';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'Invite expired';
  end if;
  if v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses then
    raise exception 'Invite exhausted';
  end if;

  insert into group_members (group_id, user_id, role)
  values (v_invite.group_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  update group_invites set use_count = use_count + 1 where id = v_invite.id;

  select * into v_group from groups where id = v_invite.group_id;
  return v_group;
end;
$$;

-- Autorise l'appel des RPC par les utilisateurs authentifiés.
grant execute on function create_group(text)            to authenticated;
grant execute on function join_group_with_token(text)   to authenticated;
grant execute on function is_group_member(uuid)         to authenticated;
grant execute on function is_group_admin(uuid)          to authenticated;

-- ####################################################################
-- ## 0004_phase1_discovery.sql
-- ####################################################################

-- ============================================================================
-- Gayeulle Party — 0004 : Phase 1 — mécanique de découverte (PostGIS)
-- ============================================================================
-- À la fin d'une session, le tracé révèle une bande autour du chemin parcouru
-- (buffer). Cette zone perce le brouillard d'exploration et devient commune
-- au groupe.
-- ============================================================================

-- Rayon de révélation autour d'un tracé, en mètres.
create or replace function reveal_radius_m()
returns double precision language sql immutable as $$ select 50.0::double precision $$;

-- Révèle une zone à partir d'un tracé : buffer du tracé -> discovered_zones.
-- Retourne l'id de la zone créée.
create or replace function reveal_zone_from_track(p_track_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_track   tracks;
  v_zone_id uuid;
begin
  select * into v_track from tracks where id = p_track_id;
  if not found then
    raise exception 'Track % not found', p_track_id;
  end if;

  -- L'appelant doit être membre du groupe du tracé.
  if not is_group_member(v_track.group_id) then
    raise exception 'Not a member of this group';
  end if;

  insert into discovered_zones (group_id, discovered_by, geom, source)
  values (
    v_track.group_id,
    v_track.user_id,
    -- buffer géographique du tracé, converti en MultiPolygon geography
    ST_Multi(ST_Buffer(v_track.geom, reveal_radius_m())::geometry)::geography,
    'session'
  )
  returning id into v_zone_id;

  return v_zone_id;
end;
$$;

-- Clôture une session : fige durée, distance, pas et statut, puis (si un tracé
-- existe) révèle la zone correspondante. Le client fournit les métriques
-- mesurées ; le serveur reste autoritaire sur le statut et la révélation.
create or replace function finish_session(
  p_session_id uuid,
  p_distance_m double precision,
  p_steps      int,
  p_duration_s int
)
returns exploration_sessions
language plpgsql security definer set search_path = public
as $$
declare
  v_session exploration_sessions;
  v_track   tracks;
begin
  select * into v_session from exploration_sessions where id = p_session_id;
  if not found then
    raise exception 'Session % not found', p_session_id;
  end if;
  if v_session.user_id <> auth.uid() then
    raise exception 'Not your session';
  end if;

  update exploration_sessions
     set ended_at   = now(),
         distance_m = greatest(p_distance_m, 0),
         steps      = greatest(p_steps, 0),
         duration_s = greatest(p_duration_s, 0),
         status     = 'finished'
   where id = p_session_id
   returning * into v_session;

  -- Révèle la zone à partir du tracé de la session, s'il y en a un.
  select * into v_track from tracks where session_id = p_session_id order by created_at desc limit 1;
  if found then
    perform reveal_zone_from_track(v_track.id);
  end if;

  return v_session;
end;
$$;

grant execute on function reveal_zone_from_track(uuid)                              to authenticated;
grant execute on function finish_session(uuid, double precision, int, int)          to authenticated;

-- ----------------------------------------------------------------------------
-- Vues GeoJSON pratiques pour la carte (tracés & zones découvertes).
-- `security_invoker = on` : la vue s'exécute avec les droits de l'appelant, donc
-- le RLS des tables sous-jacentes s'applique (un membre ne voit que son groupe).
-- ----------------------------------------------------------------------------
create or replace view discovered_zones_geojson
  with (security_invoker = on) as
  select
    id,
    group_id,
    discovered_by,
    source,
    area_m2,
    ST_AsGeoJSON(geom)::json as geometry,
    created_at
  from discovered_zones;

create or replace view tracks_geojson
  with (security_invoker = on) as
  select
    id,
    session_id,
    group_id,
    user_id,
    color,
    length_m,
    ST_AsGeoJSON(geom)::json as geometry,
    created_at
  from tracks;

-- Les vues s'exécutent avec les droits de l'appelant (security_invoker) : on
-- accorde explicitement le SELECT au rôle authentifié (le RLS des tables filtre).
grant select on discovered_zones_geojson to authenticated;
grant select on tracks_geojson           to authenticated;

-- ####################################################################
-- ## 0005_phase2_group_life.sql
-- ####################################################################

-- ============================================================================
-- Gayeulle Party — 0005 : Phase 2 — vie du groupe
-- points d'intérêt & photos, chat, présence temps réel, campements
-- ============================================================================

-- --- points_of_interest ------------------------------------------------------
create table if not exists points_of_interest (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups (id) on delete cascade,
  author_id   uuid not null references profiles (id) on delete cascade,
  kind        poi_kind not null default 'place',
  title       text,
  geom        geography(Point, 4326) not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_poi_group on points_of_interest (group_id);
create index if not exists idx_poi_geom  on points_of_interest using gist (geom);

-- --- poi_images (images d'un POI, stockées dans Supabase Storage) ------------
create table if not exists poi_images (
  id            uuid primary key default gen_random_uuid(),
  poi_id        uuid not null references points_of_interest (id) on delete cascade,
  storage_path  text not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_poi_images_poi on poi_images (poi_id);

-- --- session_photos (photos rattachées à une session) ------------------------
create table if not exists session_photos (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references exploration_sessions (id) on delete cascade,
  group_id      uuid not null references groups (id) on delete cascade,
  storage_path  text not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_session_photos_session on session_photos (session_id);

-- --- chat_messages -----------------------------------------------------------
create table if not exists chat_messages (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups (id) on delete cascade,
  author_id   uuid not null references profiles (id) on delete cascade,
  kind        message_kind not null default 'text',
  body        text,
  geom        geography(Point, 4326),                 -- pour kind = 'location'
  poi_id      uuid references points_of_interest (id) on delete set null, -- kind = 'poi'
  created_at  timestamptz not null default now()
);
create index if not exists idx_chat_group_created on chat_messages (group_id, created_at desc);

-- --- member_presence (dernière position + visibilité) ------------------------
create table if not exists member_presence (
  group_id    uuid not null references groups (id) on delete cascade,
  user_id     uuid not null references profiles (id) on delete cascade,
  geom        geography(Point, 4326),
  heading     double precision,
  visibility  presence_visibility not null default 'session_only',
  updated_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists idx_presence_geom on member_presence using gist (geom);

-- --- camps -------------------------------------------------------------------
-- Camp personnel (owner_id renseigné) ou camp de groupe (owner_id null, admin).
create table if not exists camps (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups (id) on delete cascade,
  owner_id    uuid references profiles (id) on delete cascade,
  kind        camp_kind not null,
  name        text not null,
  geom        geography(Point, 4326) not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_camps_group on camps (group_id);
create index if not exists idx_camps_geom  on camps using gist (geom);

-- ============================================================================
-- RLS Phase 2
-- ============================================================================
alter table points_of_interest enable row level security;
alter table poi_images          enable row level security;
alter table session_photos      enable row level security;
alter table chat_messages       enable row level security;
alter table member_presence     enable row level security;
alter table camps               enable row level security;

-- points_of_interest : lecture groupe, écriture par l'auteur membre.
drop policy if exists poi_select on points_of_interest;
create policy poi_select on points_of_interest for select using (is_group_member(group_id));
drop policy if exists poi_insert on points_of_interest;
create policy poi_insert on points_of_interest for insert
  with check (author_id = auth.uid() and is_group_member(group_id));
drop policy if exists poi_delete on points_of_interest;
create policy poi_delete on points_of_interest for delete
  using (author_id = auth.uid() or is_group_admin(group_id));

-- poi_images : suivent le POI parent.
drop policy if exists poi_images_select on poi_images;
create policy poi_images_select on poi_images for select using (
  exists (select 1 from points_of_interest p where p.id = poi_id and is_group_member(p.group_id))
);
drop policy if exists poi_images_insert on poi_images;
create policy poi_images_insert on poi_images for insert with check (
  exists (select 1 from points_of_interest p where p.id = poi_id and p.author_id = auth.uid())
);

-- session_photos : lecture groupe, écriture par le propriétaire de la session.
drop policy if exists session_photos_select on session_photos;
create policy session_photos_select on session_photos for select using (is_group_member(group_id));
drop policy if exists session_photos_insert on session_photos;
create policy session_photos_insert on session_photos for insert with check (
  is_group_member(group_id)
  and exists (select 1 from exploration_sessions s where s.id = session_id and s.user_id = auth.uid())
);

-- chat_messages : lecture groupe, écriture par l'auteur membre.
drop policy if exists chat_select on chat_messages;
create policy chat_select on chat_messages for select using (is_group_member(group_id));
drop policy if exists chat_insert on chat_messages;
create policy chat_insert on chat_messages for insert
  with check (author_id = auth.uid() and is_group_member(group_id));

-- member_presence : lecture groupe (respect de la visibilité côté app/serveur),
-- écriture de sa propre présence uniquement.
drop policy if exists presence_select on member_presence;
create policy presence_select on member_presence for select using (
  is_group_member(group_id) and (visibility <> 'invisible' or user_id = auth.uid())
);
drop policy if exists presence_upsert on member_presence;
create policy presence_upsert on member_presence for insert
  with check (user_id = auth.uid() and is_group_member(group_id));
drop policy if exists presence_update on member_presence;
create policy presence_update on member_presence for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- camps : lecture groupe ; camp perso par son propriétaire, camp groupe par admin.
drop policy if exists camps_select on camps;
create policy camps_select on camps for select using (is_group_member(group_id));
drop policy if exists camps_insert on camps;
create policy camps_insert on camps for insert with check (
  is_group_member(group_id)
  and (
    (kind = 'personal' and owner_id = auth.uid())
    or (kind = 'group' and is_group_admin(group_id))
  )
);
drop policy if exists camps_update on camps;
create policy camps_update on camps for update
  using (
    (kind = 'personal' and owner_id = auth.uid())
    or (kind = 'group' and is_group_admin(group_id))
  )
  with check (is_group_member(group_id));

drop policy if exists camps_delete on camps;
create policy camps_delete on camps for delete using (
  (kind = 'personal' and owner_id = auth.uid()) or is_group_admin(group_id)
);

-- ####################################################################
-- ## 0006_phase3_economy.sql
-- ####################################################################

-- ============================================================================
-- Gayeulle Party — 0006 : Phase 3 — économie & progression
-- Djadja Coins, boutique cosmétique, missions journalières, compagnon
-- ============================================================================

-- --- wallets & transactions --------------------------------------------------
create table if not exists wallets (
  user_id    uuid not null references profiles (id) on delete cascade,
  group_id   uuid not null references groups (id) on delete cascade,
  balance    bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

create table if not exists wallet_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  group_id    uuid not null references groups (id) on delete cascade,
  amount      bigint not null,               -- + crédit / - débit
  reason      txn_reason not null,
  ref_id      uuid,
  created_at  timestamptz not null default now()
);
create index if not exists idx_txn_user_group on wallet_transactions (user_id, group_id, created_at desc);

-- --- shop_items & inventory --------------------------------------------------
-- Boutique 100 % cosmétique (pas de pay-to-win).
create table if not exists shop_items (
  id         uuid primary key default gen_random_uuid(),
  category   item_category not null,
  name       text not null,
  price      bigint not null check (price >= 0),
  metadata   jsonb not null default '{}'::jsonb,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists inventory (
  user_id     uuid not null references profiles (id) on delete cascade,
  item_id     uuid not null references shop_items (id) on delete cascade,
  equipped    boolean not null default false,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- --- missions journalières ---------------------------------------------------
create table if not exists daily_missions (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  title      text not null,
  goal       int not null check (goal > 0),
  reward     bigint not null check (reward >= 0),
  for_date   date not null default current_date,
  unique (code, for_date)
);

create table if not exists mission_progress (
  user_id      uuid not null references profiles (id) on delete cascade,
  mission_id   uuid not null references daily_missions (id) on delete cascade,
  progress     int not null default 0,
  completed_at timestamptz,
  claimed      boolean not null default false,
  primary key (user_id, mission_id)
);

-- --- compagnon ---------------------------------------------------------------
create table if not exists companions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  group_id   uuid not null references groups (id) on delete cascade,
  species    text not null default 'default',
  den_geom   geography(Point, 4326),
  created_at timestamptz not null default now(),
  unique (user_id, group_id)
);

create table if not exists companion_runs (
  id             uuid primary key default gen_random_uuid(),
  companion_id   uuid not null references companions (id) on delete cascade,
  run_date       date not null default current_date,
  revealed_geom  geography(Polygon, 4326),
  created_at     timestamptz not null default now(),
  unique (companion_id, run_date)   -- une seule sortie par jour
);

-- ============================================================================
-- Économie serveur : crédit / débit atomiques (le client n'écrit jamais le solde)
-- ============================================================================
create or replace function wallet_apply(
  p_user_id  uuid,
  p_group_id uuid,
  p_amount   bigint,
  p_reason   txn_reason,
  p_ref_id   uuid default null
)
returns bigint          -- nouveau solde
language plpgsql security definer set search_path = public
as $$
declare
  v_balance bigint;
begin
  insert into wallets (user_id, group_id, balance)
  values (p_user_id, p_group_id, 0)
  on conflict (user_id, group_id) do nothing;

  update wallets
     set balance = balance + p_amount,
         updated_at = now()
   where user_id = p_user_id and group_id = p_group_id
   returning balance into v_balance;

  if v_balance < 0 then
    raise exception 'Insufficient Djadja Coins (balance would be %)', v_balance;
  end if;

  insert into wallet_transactions (user_id, group_id, amount, reason, ref_id)
  values (p_user_id, p_group_id, p_amount, p_reason, p_ref_id);

  return v_balance;
end;
$$;

-- Achat d'un objet de boutique : débit + ajout à l'inventaire.
create or replace function purchase_item(p_item_id uuid, p_group_id uuid)
returns inventory
language plpgsql security definer set search_path = public
as $$
declare
  v_item shop_items;
  v_inv  inventory;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_group_member(p_group_id) then raise exception 'Not a group member'; end if;

  select * into v_item from shop_items where id = p_item_id and active;
  if not found then raise exception 'Item not available'; end if;

  perform wallet_apply(auth.uid(), p_group_id, -v_item.price, 'purchase', p_item_id);

  insert into inventory (user_id, item_id)
  values (auth.uid(), p_item_id)
  on conflict (user_id, item_id) do nothing
  returning * into v_inv;

  return v_inv;
end;
$$;

-- ============================================================================
-- RLS Phase 3
-- ============================================================================
alter table wallets              enable row level security;
alter table wallet_transactions  enable row level security;
alter table shop_items           enable row level security;
alter table inventory            enable row level security;
alter table daily_missions       enable row level security;
alter table mission_progress     enable row level security;
alter table companions           enable row level security;
alter table companion_runs       enable row level security;

-- wallets : chacun voit son solde (lecture seule ; écriture via wallet_apply).
drop policy if exists wallets_select on wallets;
create policy wallets_select on wallets for select using (user_id = auth.uid());

drop policy if exists txn_select on wallet_transactions;
create policy txn_select on wallet_transactions for select using (user_id = auth.uid());

-- shop_items : catalogue lisible par tout utilisateur authentifié.
drop policy if exists shop_select on shop_items;
create policy shop_select on shop_items for select using (auth.uid() is not null);

-- inventory : chacun voit / gère son inventaire (achat via purchase_item).
drop policy if exists inventory_select on inventory;
create policy inventory_select on inventory for select using (user_id = auth.uid());
drop policy if exists inventory_update on inventory;
create policy inventory_update on inventory for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- missions : catalogue du jour lisible ; progression personnelle.
drop policy if exists missions_select on daily_missions;
create policy missions_select on daily_missions for select using (auth.uid() is not null);
drop policy if exists mission_progress_rw on mission_progress;
create policy mission_progress_rw on mission_progress for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- compagnon : le sien uniquement ; les runs visibles par le groupe.
drop policy if exists companions_rw on companions;
create policy companions_rw on companions for all
  using (user_id = auth.uid() and is_group_member(group_id))
  with check (user_id = auth.uid() and is_group_member(group_id));

drop policy if exists companion_runs_select on companion_runs;
create policy companion_runs_select on companion_runs for select using (
  exists (select 1 from companions c where c.id = companion_id and is_group_member(c.group_id))
);
drop policy if exists companion_runs_insert on companion_runs;
create policy companion_runs_insert on companion_runs for insert with check (
  exists (select 1 from companions c where c.id = companion_id and c.user_id = auth.uid())
);

grant execute on function wallet_apply(uuid, uuid, bigint, txn_reason, uuid) to authenticated;
grant execute on function purchase_item(uuid, uuid)                          to authenticated;

-- ####################################################################
-- ## 0007_phase4_contest.sql
-- ####################################################################

-- ============================================================================
-- Gayeulle Party — 0007 : Phase 4 — Contest, objets, événements
-- ============================================================================
-- Événements créés par l'administrateur. La résolution géométrique du Contest
-- (récupération/destruction de tracés) est faite côté serveur (PostGIS).
-- ============================================================================

-- --- events ------------------------------------------------------------------
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups (id) on delete cascade,
  created_by  uuid not null references profiles (id) on delete cascade,
  kind        event_kind not null,
  status      event_status not null default 'scheduled',
  starts_at   timestamptz,
  ends_at     timestamptz,
  rules       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_events_group on events (group_id);

create table if not exists event_participants (
  event_id  uuid not null references events (id) on delete cascade,
  user_id   uuid not null references profiles (id) on delete cascade,
  score     bigint not null default 0,
  joined_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- --- objets Contest ----------------------------------------------------------
-- Catalogue des objets (bombe, pinceau, rouleau, bouclier) ; chers par design.
create table if not exists contest_items (
  code        text primary key,             -- 'bomb' | 'brush' | 'roller' | 'shield'
  name        text not null,
  price       bigint not null check (price >= 0),
  description text
);

insert into contest_items (code, name, price, description) values
  ('bomb',   'Bombe',    500, 'Détruit une partie du tracé ennemi'),
  ('brush',  'Pinceau',  400, 'Récupère une partie du tracé adverse'),
  ('roller', 'Rouleau',  600, 'Capture une zone plus grande'),
  ('shield', 'Bouclier', 450, 'Protège une zone')
on conflict (code) do nothing;

-- --- actions Contest ---------------------------------------------------------
create table if not exists contest_actions (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events (id) on delete cascade,
  actor_id        uuid not null references profiles (id) on delete cascade,
  item_code       text not null references contest_items (code),
  target_track_id uuid references tracks (id) on delete set null,
  geom            geography(Geometry, 4326),
  resolved        boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists idx_contest_actions_event on contest_actions (event_id);
create index if not exists idx_contest_actions_geom  on contest_actions using gist (geom);

-- ============================================================================
-- RLS Phase 4
-- ============================================================================
alter table events             enable row level security;
alter table event_participants enable row level security;
alter table contest_items      enable row level security;
alter table contest_actions    enable row level security;

-- events : lecture par le groupe ; création/modif par l'admin (Le Kyk's).
drop policy if exists events_select on events;
create policy events_select on events for select using (is_group_member(group_id));
drop policy if exists events_insert on events;
create policy events_insert on events for insert
  with check (is_group_admin(group_id) and created_by = auth.uid());
drop policy if exists events_update on events;
create policy events_update on events for update
  using (is_group_admin(group_id)) with check (is_group_admin(group_id));

-- participants : lecture par le groupe ; on rejoint pour soi.
drop policy if exists event_participants_select on event_participants;
create policy event_participants_select on event_participants for select using (
  exists (select 1 from events e where e.id = event_id and is_group_member(e.group_id))
);
drop policy if exists event_participants_insert on event_participants;
create policy event_participants_insert on event_participants for insert with check (
  user_id = auth.uid()
  and exists (select 1 from events e where e.id = event_id and is_group_member(e.group_id))
);

-- contest_items : catalogue lisible par tout utilisateur authentifié.
drop policy if exists contest_items_select on contest_items;
create policy contest_items_select on contest_items for select using (auth.uid() is not null);

-- contest_actions : lecture par les participants du groupe ; action pour soi.
-- La RÉSOLUTION (découpe/transfert de tracés) est faite par une fonction serveur.
drop policy if exists contest_actions_select on contest_actions;
create policy contest_actions_select on contest_actions for select using (
  exists (select 1 from events e where e.id = event_id and is_group_member(e.group_id))
);
drop policy if exists contest_actions_insert on contest_actions;
create policy contest_actions_insert on contest_actions for insert with check (
  actor_id = auth.uid()
  and exists (select 1 from events e where e.id = event_id and is_group_member(e.group_id))
);

-- ============================================================================
-- Résolution serveur d'une action Contest (esquisse Phase 4)
-- ============================================================================
-- La récupération/destruction de tracé se calcule en PostGIS, côté serveur,
-- pour empêcher toute triche client. Squelette à compléter au moment de la
-- Phase 4 : découpe (ST_Split / ST_Difference), réattribution de portion,
-- recalcul des longueurs et des scores, prise en compte des boucliers.
create or replace function resolve_contest_action(p_action_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_action contest_actions;
begin
  select * into v_action from contest_actions where id = p_action_id and not resolved;
  if not found then return; end if;

  -- TODO (Phase 4) : selon v_action.item_code
  --   'bomb'   -> ST_Difference(tracé cible, zone d'effet)  [destruction]
  --   'brush'  -> transfert de la portion recouverte à l'acteur [récupération]
  --   'roller' -> ST_Union d'une zone plus grande dans discovered_zones
  --   'shield' -> enregistre une zone protégée, opposable aux actions offensives
  -- puis recalcul des longueurs (trigger tracks_set_length) et des scores.

  update contest_actions set resolved = true where id = p_action_id;
end;
$$;

grant execute on function resolve_contest_action(uuid) to authenticated;

-- ####################################################################
-- ## 0008_phase2_storage.sql
-- ####################################################################

-- ============================================================================
-- Gayeulle Party — 0008 : Phase 2 — stockage des photos (Supabase Storage)
-- ============================================================================
-- Buckets privés + policies alignées sur le RLS de jeu.
-- Convention de chemin : <group_id>/<...>.jpg — le premier dossier du chemin
-- est l'UUID du groupe, ce qui permet de vérifier l'appartenance.
-- ============================================================================

insert into storage.buckets (id, name, public)
values
  ('poi-images',     'poi-images',     false),
  ('chat-images',    'chat-images',    false),
  ('session-photos', 'session-photos', false)
on conflict (id) do nothing;

-- Lecture : membres du groupe (déduit du 1er dossier du chemin).
drop policy if exists "gayeulle_storage_read" on storage.objects;
create policy "gayeulle_storage_read" on storage.objects for select
  using (
    bucket_id in ('poi-images', 'chat-images', 'session-photos')
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );

-- Écriture : membres du groupe, dans le dossier de leur groupe uniquement.
drop policy if exists "gayeulle_storage_insert" on storage.objects;
create policy "gayeulle_storage_insert" on storage.objects for insert
  with check (
    bucket_id in ('poi-images', 'chat-images', 'session-photos')
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );

-- Suppression : l'auteur de l'objet (owner) ou un admin du groupe.
drop policy if exists "gayeulle_storage_delete" on storage.objects;
create policy "gayeulle_storage_delete" on storage.objects for delete
  using (
    bucket_id in ('poi-images', 'chat-images', 'session-photos')
    and (
      owner = auth.uid()
      or is_group_admin(((storage.foldername(name))[1])::uuid)
    )
  );

-- ####################################################################
-- ## 0009_phase2_latlng.sql
-- ####################################################################

-- ============================================================================
-- Gayeulle Party — 0009 : Phase 2 — colonnes lat/lng générées
-- ============================================================================
-- PostgREST renvoie les colonnes geography en WKB (hex), peu pratique côté
-- mobile, et les flux Realtime ne passent pas par les vues. On expose donc
-- lat/lng en colonnes générées (lisibles partout, y compris en Realtime).
-- L'écriture continue de se faire sur `geom` (GeoJSON accepté à l'insertion).
-- ============================================================================

alter table points_of_interest
  add column if not exists lat double precision
    generated always as (ST_Y(geom::geometry)) stored,
  add column if not exists lng double precision
    generated always as (ST_X(geom::geometry)) stored;

alter table camps
  add column if not exists lat double precision
    generated always as (ST_Y(geom::geometry)) stored,
  add column if not exists lng double precision
    generated always as (ST_X(geom::geometry)) stored;

alter table member_presence
  add column if not exists lat double precision
    generated always as (ST_Y(geom::geometry)) stored,
  add column if not exists lng double precision
    generated always as (ST_X(geom::geometry)) stored;

alter table chat_messages
  add column if not exists lat double precision
    generated always as (ST_Y(geom::geometry)) stored,
  add column if not exists lng double precision
    generated always as (ST_X(geom::geometry)) stored;

-- Realtime : diffuse les tables « vivantes » de la Phase 2.
-- (Sur Supabase cloud/local, la publication supabase_realtime existe déjà.)
do $$
begin
  alter publication supabase_realtime add table chat_messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table member_presence;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table discovered_zones;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table tracks;
exception when duplicate_object then null;
end $$;

-- ####################################################################
-- ## 0010_phase3_gameplay.sql
-- ####################################################################

-- ============================================================================
-- Gayeulle Party — 0010 : Phase 3 — logique de gameplay (économie serveur)
-- ============================================================================
-- Missions journalières, réclamation de récompenses, sortie quotidienne du
-- compagnon. Tout ce qui touche aux Djadja Coins passe par des fonctions
-- SECURITY DEFINER (le client n'écrit jamais directement le solde).
-- ============================================================================

-- Catégorie d'activité rattachée à une mission (pour l'avancement automatique).
alter table daily_missions
  add column if not exists category text not null default 'walk';

-- Coordonnées lisibles de la niche du compagnon (comme pour la Phase 2).
alter table companions
  add column if not exists den_lat double precision
    generated always as (ST_Y(den_geom::geometry)) stored,
  add column if not exists den_lng double precision
    generated always as (ST_X(den_geom::geometry)) stored;

-- Backfill des missions déjà semées (par code).
update daily_missions set category = case
  when code like 'walk%'      then 'walk'
  when code like 'explore%'   then 'explore'
  when code = 'take_photo'    then 'photo'
  when code = 'use_companion' then 'companion'
  else category
end
where category = 'walk' and code not like 'walk%';

-- ----------------------------------------------------------------------------
-- Missions du jour : crée le lot standard pour aujourd'hui (idempotent).
-- Appelé par l'app au chargement — évite d'avoir besoin d'un cron pour démarrer.
-- ----------------------------------------------------------------------------
create or replace function ensure_daily_missions()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into daily_missions (code, title, category, goal, reward, for_date) values
    ('walk_2km',      'Marcher 2 km',                    'walk',      2000, 100, current_date),
    ('explore_zone',  'Révéler une nouvelle zone',       'explore',      1, 150, current_date),
    ('take_photo',    'Ajouter une photo souvenir',      'photo',        1,  50, current_date),
    ('use_companion', 'Envoyer ton compagnon explorer',  'companion',    1,  50, current_date)
  on conflict (code, for_date) do nothing;
end;
$$;

-- ----------------------------------------------------------------------------
-- Avancement d'activité : incrémente la progression des missions du jour de la
-- catégorie donnée pour le joueur courant (marche = mètres, autres = unités).
-- ----------------------------------------------------------------------------
create or replace function record_activity(p_category text, p_amount int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_mission daily_missions;
  v_progress int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_amount <= 0 then return; end if;

  for v_mission in
    select * from daily_missions
    where for_date = current_date and category = p_category
  loop
    insert into mission_progress (user_id, mission_id, progress)
    values (auth.uid(), v_mission.id, 0)
    on conflict (user_id, mission_id) do nothing;

    update mission_progress
       set progress = least(progress + p_amount, v_mission.goal),
           completed_at = case
             when completed_at is null and progress + p_amount >= v_mission.goal
             then now() else completed_at end
     where user_id = auth.uid() and mission_id = v_mission.id
     returning progress into v_progress;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Réclamation d'une mission terminée : crédite la récompense dans le
-- portefeuille du groupe choisi (une seule fois).
-- ----------------------------------------------------------------------------
create or replace function claim_mission(p_mission_id uuid, p_group_id uuid)
returns bigint       -- nouveau solde
language plpgsql security definer set search_path = public
as $$
declare
  v_reward  bigint;
  v_prog    mission_progress;
  v_balance bigint;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_group_member(p_group_id) then raise exception 'Not a group member'; end if;

  select * into v_prog from mission_progress
    where user_id = auth.uid() and mission_id = p_mission_id;
  if not found or v_prog.completed_at is null then
    raise exception 'Mission not completed';
  end if;
  if v_prog.claimed then
    raise exception 'Reward already claimed';
  end if;

  select reward into v_reward from daily_missions where id = p_mission_id;

  v_balance := wallet_apply(auth.uid(), p_group_id, v_reward, 'mission', p_mission_id);

  update mission_progress set claimed = true
    where user_id = auth.uid() and mission_id = p_mission_id;

  return v_balance;
end;
$$;

-- ============================================================================
-- Compagnon
-- ============================================================================

-- Récupère le compagnon du joueur pour un groupe, en le créant si besoin.
-- La niche (den) est posée à la position fournie (ex. camp personnel / position).
create or replace function get_or_create_companion(
  p_group_id uuid,
  p_lat      double precision,
  p_lng      double precision,
  p_species  text default 'default'
)
returns companions
language plpgsql security definer set search_path = public
as $$
declare
  v_comp companions;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_group_member(p_group_id) then raise exception 'Not a group member'; end if;

  select * into v_comp from companions
    where user_id = auth.uid() and group_id = p_group_id;

  if found then
    -- Pose la niche si elle n'existait pas encore.
    if v_comp.den_geom is null then
      update companions
         set den_geom = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
       where id = v_comp.id
       returning * into v_comp;
    end if;
    return v_comp;
  end if;

  insert into companions (user_id, group_id, species, den_geom)
  values (
    auth.uid(), p_group_id, p_species,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  )
  returning * into v_comp;
  return v_comp;
end;
$$;

-- Sortie quotidienne : le compagnon part de sa niche, révèle ~100 m dans une
-- direction inconnue, puis revient. Une seule fois par jour. Petit bonus de coins.
create or replace function companion_daily_run(p_group_id uuid)
returns companion_runs
language plpgsql security definer set search_path = public
as $$
declare
  v_comp    companions;
  v_azimuth double precision;
  v_target  geography;
  v_reveal  geography;   -- polygon
  v_run     companion_runs;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into v_comp from companions
    where user_id = auth.uid() and group_id = p_group_id;
  if not found then raise exception 'No companion for this group'; end if;
  if v_comp.den_geom is null then raise exception 'Companion has no den yet'; end if;

  if exists (
    select 1 from companion_runs
    where companion_id = v_comp.id and run_date = current_date
  ) then
    raise exception 'Companion already explored today';
  end if;

  -- Point à ~100 m de la niche, dans une direction aléatoire, puis zone révélée.
  v_azimuth := random() * 2 * pi();
  v_target  := ST_Project(v_comp.den_geom, 100.0, v_azimuth);
  v_reveal  := ST_Buffer(v_target, 60.0);   -- ~120 m de diamètre

  insert into companion_runs (companion_id, run_date, revealed_geom)
  values (v_comp.id, current_date, v_reveal::geometry::geography)
  returning * into v_run;

  -- Alimente la carte commune du groupe.
  insert into discovered_zones (group_id, discovered_by, geom, source)
  values (
    p_group_id, auth.uid(),
    ST_Multi(v_reveal::geometry)::geography,
    'companion'
  );

  -- Récompense + avancement de la mission « compagnon ».
  perform wallet_apply(auth.uid(), p_group_id, 25, 'companion', v_run.id);
  perform record_activity('companion', 1);

  return v_run;
end;
$$;

-- Realtime : le solde de Djadja Coins se met à jour en direct (missions,
-- achats, compagnon).
do $$
begin
  alter publication supabase_realtime add table wallets;
exception when duplicate_object then null;
end $$;

grant execute on function ensure_daily_missions()                                       to authenticated;
grant execute on function record_activity(text, int)                                    to authenticated;
grant execute on function claim_mission(uuid, uuid)                                      to authenticated;
grant execute on function get_or_create_companion(uuid, double precision, double precision, text) to authenticated;
grant execute on function companion_daily_run(uuid)                                      to authenticated;

-- ####################################################################
-- ## 0011_phase4_contest_logic.sql
-- ####################################################################

-- ============================================================================
-- Gayeulle Party — 0011 : Phase 4 — logique de Contest (PostGIS, serveur)
-- ============================================================================
-- Récupération / destruction de tracés, objets (bombe, pinceau, rouleau,
-- bouclier), scoring. Toute la résolution géométrique est faite côté serveur
-- (anti-triche) ; les boucliers protègent les zones contre les actions
-- offensives.
-- ============================================================================

-- Les fragments de tracé issus du Contest / du compagnon n'ont pas de session.
alter table tracks alter column session_id drop not null;

-- --- Inventaire d'objets Contest (consommables achetés en Djadja Coins) ------
create table if not exists contest_inventory (
  user_id    uuid not null references profiles (id) on delete cascade,
  group_id   uuid not null references groups (id) on delete cascade,
  item_code  text not null references contest_items (code),
  quantity   int not null default 0 check (quantity >= 0),
  primary key (user_id, group_id, item_code)
);

-- --- Zones protégées par un bouclier -----------------------------------------
create table if not exists contest_shields (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events (id) on delete cascade,
  group_id    uuid not null references groups (id) on delete cascade,
  owner_id    uuid not null references profiles (id) on delete cascade,
  geom        geography(MultiPolygon, 4326) not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_shields_event on contest_shields (event_id);
create index if not exists idx_shields_geom  on contest_shields using gist (geom);

-- --- RLS ---------------------------------------------------------------------
alter table contest_inventory enable row level security;
alter table contest_shields   enable row level security;

drop policy if exists contest_inventory_select on contest_inventory;
create policy contest_inventory_select on contest_inventory for select
  using (user_id = auth.uid());

drop policy if exists contest_shields_select on contest_shields;
create policy contest_shields_select on contest_shields for select
  using (is_group_member(group_id));
-- (Les écritures passent par les fonctions SECURITY DEFINER ci-dessous.)

-- ============================================================================
-- Achat d'objets Contest (débit Djadja Coins)
-- ============================================================================
create or replace function buy_contest_item(
  p_group_id uuid, p_item_code text, p_qty int
)
returns int          -- nouvelle quantité en stock
language plpgsql security definer set search_path = public
as $$
declare
  v_price bigint;
  v_qty   int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_group_member(p_group_id) then raise exception 'Not a group member'; end if;
  if p_qty <= 0 then raise exception 'Invalid quantity'; end if;

  select price into v_price from contest_items where code = p_item_code;
  if not found then raise exception 'Unknown item'; end if;

  perform wallet_apply(auth.uid(), p_group_id, -v_price * p_qty, 'contest', null);

  insert into contest_inventory (user_id, group_id, item_code, quantity)
  values (auth.uid(), p_group_id, p_item_code, p_qty)
  on conflict (user_id, group_id, item_code)
    do update set quantity = contest_inventory.quantity + p_qty
  returning quantity into v_qty;

  return v_qty;
end;
$$;

-- ============================================================================
-- Recalcul des scores d'un événement
-- score = mètres de tracé possédés + surface de zones Contest capturées × 0.05
-- ============================================================================
create or replace function recompute_event_scores(p_event_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update event_participants ep
  set score = greatest(0, floor(
        coalesce((
          select sum(t.length_m) from tracks t
          where t.group_id = e.group_id and t.user_id = ep.user_id
        ), 0)
      + coalesce((
          select sum(z.area_m2) * 0.05 from discovered_zones z
          where z.group_id = e.group_id and z.source = 'contest'
            and z.discovered_by = ep.user_id
        ), 0)
      ))::bigint
  from events e
  where ep.event_id = e.id and e.id = p_event_id;
end;
$$;

-- ============================================================================
-- Cœur : applique un effet de zone sur les tracés adverses
--   p_mode = 'bomb'  → détruit la portion recouverte
--   p_mode = 'brush' → transfère la portion recouverte à l'acteur
-- Respecte les boucliers (les zones protégées sont soustraites de l'effet).
-- ============================================================================
create or replace function contest_apply_area(
  p_event_id uuid,
  p_actor    uuid,
  p_area     geometry,     -- zone d'effet brute (SRID 4326)
  p_mode     text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_group       uuid;
  v_shields     geometry;
  v_effective   geometry;
  v_actor_color text;
  v_ids         uuid[];
  v_id          uuid;
  v_track       tracks;
  v_remaining   geometry;
  v_inside      geometry;
begin
  select group_id into v_group from events where id = p_event_id;
  if v_group is null then return; end if;

  -- Union des boucliers de l'événement → zones protégées.
  select ST_Union(geom::geometry) into v_shields
    from contest_shields where event_id = p_event_id;

  v_effective := case
    when v_shields is null then p_area
    else ST_Difference(p_area, v_shields)
  end;
  if v_effective is null or ST_IsEmpty(v_effective) then return; end if;

  select color into v_actor_color from profiles where id = p_actor;

  -- Fige la liste des tracés adverses touchés (évite de retraiter les fragments).
  v_ids := array(
    select id from tracks
    where group_id = v_group and user_id <> p_actor
      and ST_Intersects(geom::geometry, v_effective)
  );

  foreach v_id in array v_ids loop
    select * into v_track from tracks where id = v_id;
    if not found then continue; end if;

    v_remaining := ST_Difference(v_track.geom::geometry, v_effective);
    delete from tracks where id = v_id;

    -- L'adversaire conserve la partie hors zone.
    insert into tracks (session_id, group_id, user_id, geom, color)
    select v_track.session_id, v_track.group_id, v_track.user_id,
           (dp.geom)::geography, v_track.color
    from ST_Dump(v_remaining) dp
    where GeometryType(dp.geom) = 'LINESTRING' and not ST_IsEmpty(dp.geom);

    -- Pinceau : la partie recouverte revient à l'acteur.
    if p_mode = 'brush' then
      v_inside := ST_Intersection(v_track.geom::geometry, v_effective);
      insert into tracks (session_id, group_id, user_id, geom, color)
      select null, v_track.group_id, p_actor, (dp.geom)::geography, v_actor_color
      from ST_Dump(v_inside) dp
      where GeometryType(dp.geom) = 'LINESTRING' and not ST_IsEmpty(dp.geom);
    end if;
  end loop;

  perform recompute_event_scores(p_event_id);
end;
$$;

-- ============================================================================
-- Utilisation d'un objet Contest (point visé → zone d'effet)
-- ============================================================================
create or replace function use_contest_item(
  p_event_id uuid,
  p_item_code text,
  p_lat double precision,
  p_lng double precision
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_event   events;
  v_qty     int;
  v_point   geography;
  v_radius  double precision;
  v_effect  geography;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into v_event from events where id = p_event_id;
  if not found then raise exception 'Event not found'; end if;
  if v_event.status <> 'active' then raise exception 'Event not active'; end if;
  if v_event.kind not in ('contest', 'contest_compass') then
    raise exception 'Not a contest event';
  end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not a group member'; end if;

  -- Décrémente le stock (doit être > 0).
  update contest_inventory
     set quantity = quantity - 1
   where user_id = auth.uid() and group_id = v_event.group_id
     and item_code = p_item_code and quantity > 0
   returning quantity into v_qty;
  if not found then raise exception 'No % left', p_item_code; end if;

  v_radius := case p_item_code
    when 'bomb'   then 40.0
    when 'brush'  then 40.0
    when 'roller' then 80.0
    when 'shield' then 60.0
    else 40.0 end;

  v_point  := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
  v_effect := ST_Buffer(v_point, v_radius);

  -- Journalise l'action.
  insert into contest_actions (event_id, actor_id, item_code, geom, resolved)
  values (p_event_id, auth.uid(), p_item_code, v_effect, true);

  if p_item_code = 'shield' then
    insert into contest_shields (event_id, group_id, owner_id, geom)
    values (p_event_id, v_event.group_id, auth.uid(),
            ST_Multi(v_effect::geometry)::geography);

  elsif p_item_code = 'roller' then
    -- Capture une zone plus grande, attribuée à l'acteur (scoring).
    insert into discovered_zones (group_id, discovered_by, geom, source)
    values (v_event.group_id, auth.uid(),
            ST_Multi(v_effect::geometry)::geography, 'contest');
    perform recompute_event_scores(p_event_id);

  elsif p_item_code = 'bomb' then
    perform contest_apply_area(p_event_id, auth.uid(), v_effect::geometry, 'bomb');

  elsif p_item_code = 'brush' then
    perform contest_apply_area(p_event_id, auth.uid(), v_effect::geometry, 'brush');
  end if;
end;
$$;

-- ============================================================================
-- Mode Contest — récupération passive en passant sur le tracé adverse
-- Le joueur fournit son chemin récent ; un corridor autour récupère les
-- portions des tracés des autres (hors boucliers).
-- ============================================================================
create or replace function contest_pass_recover(
  p_event_id uuid,
  p_line     jsonb        -- géométrie GeoJSON LineString
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_event    events;
  v_corridor geography;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into v_event from events where id = p_event_id;
  if not found or v_event.status <> 'active' then return; end if;
  if v_event.kind not in ('contest', 'contest_compass') then return; end if;
  if not is_group_member(v_event.group_id) then return; end if;

  -- Corridor de ~15 m autour du chemin parcouru.
  v_corridor := ST_Buffer(ST_GeomFromGeoJSON(p_line::text)::geography, 15.0);

  perform contest_apply_area(p_event_id, auth.uid(), v_corridor::geometry, 'brush');
end;
$$;

-- Realtime : bannière d'événement actif et classement en direct.
do $$ begin
  alter publication supabase_realtime add table events;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table event_participants;
exception when duplicate_object then null; end $$;

grant execute on function buy_contest_item(uuid, text, int)                             to authenticated;
grant execute on function recompute_event_scores(uuid)                                  to authenticated;
grant execute on function contest_apply_area(uuid, uuid, geometry, text)                to authenticated;
grant execute on function use_contest_item(uuid, text, double precision, double precision) to authenticated;
grant execute on function contest_pass_recover(uuid, jsonb)                             to authenticated;

-- ####################################################################
-- ## seed.sql (catalogues boutique + missions du jour)
-- ####################################################################

-- ============================================================================
-- Gayeulle Party — seed (données de démarrage pour le dev local)
-- ============================================================================
-- Appliqué par `supabase db reset`. Ne dépend d'aucun compte auth : il ne
-- remplit que les catalogues (boutique, missions du jour) lisibles par tous.
-- Les groupes/joueurs se créent via l'app (RPC create_group / join).
-- ============================================================================

-- --- Catalogue boutique (cosmétique uniquement) ------------------------------
insert into shop_items (category, name, price, metadata) values
  ('avatar_skin', 'Explorateur Néon',      300, '{"rarity":"common"}'),
  ('avatar_skin', 'Aventurier Rétro',      500, '{"rarity":"rare"}'),
  ('clothing',    'Veste pixel',           200, '{"slot":"body"}'),
  ('companion',   'Renard des villes',     800, '{"species":"fox"}'),
  ('companion',   'Corbeau explorateur',   800, '{"species":"crow"}'),
  ('camp',        'Tente cosy',            400, '{"theme":"cozy"}'),
  ('map',         'Style carte crépuscule',600, '{"style":"dusk"}'),
  ('trail',       'Tracé arc-en-ciel',     700, '{"effect":"rainbow"}'),
  ('effect',      'Aura lumineuse',        350, '{"effect":"glow"}')
on conflict do nothing;

-- --- Missions du jour --------------------------------------------------------
insert into daily_missions (code, title, category, goal, reward, for_date) values
  ('walk_2km',      'Marcher 2 km',                   'walk',      2000, 100, current_date),
  ('explore_zone',  'Révéler une nouvelle zone',      'explore',      1, 150, current_date),
  ('take_photo',    'Ajouter une photo souvenir',     'photo',        1,  50, current_date),
  ('use_companion', 'Envoyer ton compagnon explorer', 'companion',    1,  50, current_date)
on conflict (code, for_date) do nothing;
