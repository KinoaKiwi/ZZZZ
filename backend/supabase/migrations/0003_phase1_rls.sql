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
