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
