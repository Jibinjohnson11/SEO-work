-- Brand logos: an optional logo per client (shown as "brand" in the UI).
--
--   * clients.logo_path: storage path of the current logo in the brand-logos bucket, or NULL.
--   * brand-logos: PRIVATE bucket, 2 MB limit, PNG / JPEG / SVG / WebP only. Paths are
--     "<client_id>/<random>.<ext>". Only Super Admins can read, upload or delete; the dashboard shows
--     logos through short-lived signed URLs created on the server.
--
-- Additive only: existing rows keep logo_path = NULL (the UI shows a placeholder).
--
-- Rollback (supabase/rollbacks/20261021000017_brand_logos.rollback.sql) drops the storage policies.
-- The column and the bucket are deliberately KEPT: the column is nullable and ignored by the old code,
-- and dropping either would erase uploaded logos.

alter table public.clients add column if not exists logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-logos', 'brand-logos', false, 2097152, array['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
on conflict (id) do nothing;

create policy "brand logos read" on storage.objects for select to authenticated
  using (bucket_id = 'brand-logos' and public.is_super_admin());
create policy "brand logos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'brand-logos' and public.is_super_admin());
create policy "brand logos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'brand-logos' and public.is_super_admin());
