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
