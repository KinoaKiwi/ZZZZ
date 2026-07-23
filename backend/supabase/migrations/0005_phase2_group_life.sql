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
