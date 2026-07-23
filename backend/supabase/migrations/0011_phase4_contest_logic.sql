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
