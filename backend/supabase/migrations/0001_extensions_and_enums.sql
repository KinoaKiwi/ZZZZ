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
