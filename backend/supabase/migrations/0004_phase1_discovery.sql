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
