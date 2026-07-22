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
insert into daily_missions (code, title, goal, reward, for_date) values
  ('walk_2km',      'Marcher 2 km',                 2000, 100, current_date),
  ('explore_zone',  'Révéler une nouvelle zone',       1, 150, current_date),
  ('take_photo',    'Ajouter une photo souvenir',      1,  50, current_date),
  ('use_companion', 'Envoyer ton compagnon explorer',  1,  50, current_date)
on conflict (code, for_date) do nothing;
