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
