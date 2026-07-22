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
