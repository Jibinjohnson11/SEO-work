-- Private bucket for supporting files. Paths are "<submission_id>/<random>-<file name>".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'submission-files', 'submission-files', false, 10485760,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

create or replace function public.storage_submission_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  v text := split_part(p_name, '/', 1);
begin
  if v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  return null;
end;
$$;

create or replace function public.can_edit_submission_files(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin() or exists (
    select 1 from public.backlink_submissions s
    where s.id = p_submission_id and s.intern_id = auth.uid() and public.auth_role() = 'intern'
      and s.status in ('draft', 'internal_changes_requested', 'client_changes_requested'))
$$;

create policy "submission files read" on storage.objects for select to authenticated
  using (bucket_id = 'submission-files'
         and (public.is_super_admin() or public.is_my_submission(public.storage_submission_id(name))));
create policy "submission files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'submission-files'
              and public.can_edit_submission_files(public.storage_submission_id(name)));
create policy "submission files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'submission-files'
         and public.can_edit_submission_files(public.storage_submission_id(name)));

create or replace function public.submission_add_file(
  p_submission_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.can_edit_submission_files(p_submission_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if public.storage_submission_id(p_storage_path) is distinct from p_submission_id then
    raise exception 'File path does not belong to this submission' using errcode = '22023';
  end if;
  insert into public.submission_files (submission_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (p_submission_id, p_storage_path, p_file_name, p_mime_type, p_size_bytes, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.submission_remove_file(p_file_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.submission_files;
begin
  select * into f from public.submission_files where id = p_file_id;
  if not found or not public.can_edit_submission_files(f.submission_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  delete from public.submission_files where id = p_file_id;
  return f.storage_path;
end;
$$;

grant execute on function public.storage_submission_id(text), public.can_edit_submission_files(uuid),
  public.submission_add_file(uuid, text, text, text, bigint), public.submission_remove_file(uuid)
to authenticated;
