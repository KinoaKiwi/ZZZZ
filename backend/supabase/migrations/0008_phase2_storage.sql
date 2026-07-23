-- ============================================================================
-- Gayeulle Party — 0008 : Phase 2 — stockage des photos (Supabase Storage)
-- ============================================================================
-- Buckets privés + policies alignées sur le RLS de jeu.
-- Convention de chemin : <group_id>/<...>.jpg — le premier dossier du chemin
-- est l'UUID du groupe, ce qui permet de vérifier l'appartenance.
-- ============================================================================

insert into storage.buckets (id, name, public)
values
  ('poi-images',     'poi-images',     false),
  ('chat-images',    'chat-images',    false),
  ('session-photos', 'session-photos', false)
on conflict (id) do nothing;

-- Lecture : membres du groupe (déduit du 1er dossier du chemin).
drop policy if exists "gayeulle_storage_read" on storage.objects;
create policy "gayeulle_storage_read" on storage.objects for select
  using (
    bucket_id in ('poi-images', 'chat-images', 'session-photos')
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );

-- Écriture : membres du groupe, dans le dossier de leur groupe uniquement.
drop policy if exists "gayeulle_storage_insert" on storage.objects;
create policy "gayeulle_storage_insert" on storage.objects for insert
  with check (
    bucket_id in ('poi-images', 'chat-images', 'session-photos')
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );

-- Suppression : l'auteur de l'objet (owner) ou un admin du groupe.
drop policy if exists "gayeulle_storage_delete" on storage.objects;
create policy "gayeulle_storage_delete" on storage.objects for delete
  using (
    bucket_id in ('poi-images', 'chat-images', 'session-photos')
    and (
      owner = auth.uid()
      or is_group_admin(((storage.foldername(name))[1])::uuid)
    )
  );
