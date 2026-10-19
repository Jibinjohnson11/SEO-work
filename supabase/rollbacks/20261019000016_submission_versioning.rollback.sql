-- ROLLBACK for 20261019000016_submission_versioning.sql. NOT a migration: run only by the reviewed
-- procedure, in ONE transaction, after confirming the database is at the post-16 state.
--
-- Restores the pre-16 function definitions (copied verbatim from 20261012000003_workflow.sql, with
-- the migration-9 renames), removes the helpers and the append-only triggers.
--
-- Deliberately NOT reverted (documented consequences):
--   * submission_versions.change_type and .approval_carried_from are KEPT. They are nullable and the
--     old code ignores them; dropping them would erase which versions were minor/unchanged and which
--     carried a client approval forward.
--   * Versions written while 16 was active stay as written (complete snapshots, hashes over the
--     9-field material definition). After rollback the old code compares hashes, so the first
--     resubmission of such a submission may create one extra "material" version. Harmless.
--   * Submissions whose current version relies on a carried-forward approval can no longer be
--     published after rollback (the old check requires an approval of the current version); send
--     them to the client again or use the admin override. This fails safe.
--   * History rows are append-only while 16 is active; anything recorded stays recorded.

drop trigger submission_versions_immutable on public.submission_versions;
drop trigger internal_reviews_immutable on public.internal_reviews;
drop trigger client_approvals_immutable on public.client_approvals;
drop function public.prevent_history_mutation();

create or replace function public._submission_material(s public.backlink_submissions)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'proposed_website', s.proposed_website,
    'placement_url', s.placement_url,
    'target_url', s.target_url,
    'anchor_text', s.anchor_text,
    'content_title', s.content_title,
    'content_draft', s.content_draft
  )
$$;

create function public._snapshot_submission(p_id uuid, p_summary text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
  v_hash text;
  v_last text;
begin
  select * into s from public.backlink_submissions where id = p_id;
  v_hash := md5(public._submission_material(s)::text);
  select content_hash into v_last from public.submission_versions
    where submission_id = p_id order by version desc limit 1;
  if v_last is not distinct from v_hash then
    return false;
  end if;
  insert into public.submission_versions (submission_id, version, snapshot, content_hash, change_summary, created_by)
  values (
    p_id, s.current_version + 1,
    public._submission_material(s) || jsonb_build_object(
      'link_attribute', s.link_attribute, 'backlink_type_id', s.backlink_type_id, 'keyword_id', s.keyword_id),
    v_hash, p_summary, auth.uid());
  update public.backlink_submissions set current_version = current_version + 1 where id = p_id;
  return true;
end;
$$;

create or replace function public._submission_save_impl(p_id uuid, p_data jsonb, p_submit boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  s public.backlink_submissions;
  c public.campaigns;
  f record;
  t public.backlink_types;
  v_campaign uuid;
  v_type uuid;
  v_keyword uuid := nullif(p_data ->> 'keyword_id', '')::uuid;
  v_task uuid := nullif(p_data ->> 'task_id', '')::uuid;
  v_field text;
  v_id uuid;
  v_next public.submission_status;
begin
  if public.auth_role() is distinct from 'intern' then
    raise exception 'Only interns can create or edit their submissions' using errcode = '42501';
  end if;

  if p_id is not null then
    select * into s from public.backlink_submissions where id = p_id for update;
    if not found or s.intern_id <> v_uid then
      raise exception 'Submission not found' using errcode = 'P0002';
    end if;
    if s.status not in ('draft', 'internal_changes_requested', 'client_changes_requested') then
      raise exception 'This submission can no longer be edited (status: %)', s.status using errcode = '22023';
    end if;
    v_campaign := s.campaign_id;
  else
    v_campaign := nullif(p_data ->> 'campaign_id', '')::uuid;
  end if;

  select * into c from public.campaigns where id = v_campaign;
  if not found or v_campaign not in (select public.my_campaign_ids()) then
    raise exception 'You are not assigned to this campaign' using errcode = '42501';
  end if;
  if c.status <> 'active' then
    raise exception 'Campaign % is not active', c.code using errcode = '22023';
  end if;

  v_type := coalesce(nullif(p_data ->> 'backlink_type_id', '')::uuid, s.backlink_type_id);
  select * into t from public.backlink_types where id = v_type and is_active;
  if not found then
    raise exception 'Backlink type is not available' using errcode = '22023';
  end if;
  if exists (select 1 from public.campaign_backlink_types where campaign_id = v_campaign)
     and not exists (select 1 from public.campaign_backlink_types
                     where campaign_id = v_campaign and backlink_type_id = v_type) then
    raise exception 'Backlink type "%" is not allowed for campaign %', t.name, c.code using errcode = '22023';
  end if;

  if v_keyword is not null and not exists (
    select 1 from public.campaign_keywords where campaign_id = v_campaign and keyword_id = v_keyword) then
    raise exception 'Keyword is not part of this campaign' using errcode = '22023';
  end if;
  if v_task is not null and not exists (
    select 1 from public.tasks where id = v_task and intern_id = v_uid and campaign_id = v_campaign
      and status not in ('cancelled', 'completed')) then
    raise exception 'Task is not an open task of yours for this campaign' using errcode = '22023';
  end if;

  if nullif(btrim(p_data ->> 'proposed_website'), '') is null then
    raise exception 'Proposed website is required' using errcode = '22023';
  end if;
  if nullif(btrim(p_data ->> 'target_url'), '') is null or not public.is_http_url(btrim(p_data ->> 'target_url')) then
    raise exception 'A valid target URL is required' using errcode = '22023';
  end if;
  if nullif(btrim(p_data ->> 'placement_url'), '') is not null
     and not public.is_http_url(btrim(p_data ->> 'placement_url')) then
    raise exception 'Proposed placement URL is not a valid URL' using errcode = '22023';
  end if;

  if p_submit then
    foreach v_field in array t.required_fields loop
      if nullif(btrim(p_data ->> v_field), '') is null then
        raise exception 'Field "%" is required for % submissions', replace(v_field, '_', ' '), t.name
          using errcode = '22023';
      end if;
    end loop;
  end if;

  if p_id is null then
    insert into public.backlink_submissions (client_id, campaign_id, intern_id, backlink_type_id, keyword_id, task_id,
      proposed_website, proposed_domain, placement_url, target_url, anchor_text, content_title, content_draft, notes,
      domain_rating, domain_authority, estimated_traffic, website_relevance, outreach_contact, outreach_status,
      link_attribute)
    values (c.client_id, v_campaign, v_uid, v_type, v_keyword, v_task,
      btrim(p_data ->> 'proposed_website'), coalesce(public.url_domain(p_data ->> 'proposed_website'), ''),
      nullif(btrim(p_data ->> 'placement_url'), ''), btrim(p_data ->> 'target_url'),
      nullif(btrim(p_data ->> 'anchor_text'), ''), nullif(btrim(p_data ->> 'content_title'), ''),
      nullif(p_data ->> 'content_draft', ''), nullif(p_data ->> 'notes', ''),
      nullif(p_data ->> 'domain_rating', '')::numeric, nullif(p_data ->> 'domain_authority', '')::numeric,
      nullif(p_data ->> 'estimated_traffic', '')::integer, nullif(btrim(p_data ->> 'website_relevance'), ''),
      nullif(btrim(p_data ->> 'outreach_contact'), ''), nullif(p_data ->> 'outreach_status', '')::public.outreach_status,
      nullif(p_data ->> 'link_attribute', '')::public.link_attribute)
    returning id into v_id;
    perform public.log_activity('submission.created', 'backlink_submissions', v_id::text, c.client_id,
      'Draft created', '{}'::jsonb);
  else
    v_id := p_id;
    update public.backlink_submissions set
      backlink_type_id = v_type, keyword_id = v_keyword, task_id = v_task,
      proposed_website = btrim(p_data ->> 'proposed_website'),
      proposed_domain = coalesce(public.url_domain(p_data ->> 'proposed_website'), ''),
      placement_url = nullif(btrim(p_data ->> 'placement_url'), ''),
      target_url = btrim(p_data ->> 'target_url'),
      anchor_text = nullif(btrim(p_data ->> 'anchor_text'), ''),
      content_title = nullif(btrim(p_data ->> 'content_title'), ''),
      content_draft = nullif(p_data ->> 'content_draft', ''),
      notes = nullif(p_data ->> 'notes', ''),
      domain_rating = nullif(p_data ->> 'domain_rating', '')::numeric,
      domain_authority = nullif(p_data ->> 'domain_authority', '')::numeric,
      estimated_traffic = nullif(p_data ->> 'estimated_traffic', '')::integer,
      website_relevance = nullif(btrim(p_data ->> 'website_relevance'), ''),
      outreach_contact = nullif(btrim(p_data ->> 'outreach_contact'), ''),
      outreach_status = nullif(p_data ->> 'outreach_status', '')::public.outreach_status,
      link_attribute = nullif(p_data ->> 'link_attribute', '')::public.link_attribute
    where id = v_id;
  end if;

  perform public._task_started(v_task);

  if p_submit then
    perform public._snapshot_submission(v_id, nullif(p_data ->> 'change_summary', ''));
    update public.backlink_submissions
      set first_submitted_at = coalesce(first_submitted_at, now()), last_submitted_at = now()
      where id = v_id;
    perform public._set_submission_status(v_id, 'submitted', nullif(p_data ->> 'change_summary', ''));
    select * into s from public.backlink_submissions where id = v_id;
    select * into f from public.campaign_flags(v_campaign);

    if not f.require_internal_review then
      v_next := case when f.require_client_approval then 'awaiting_client_approval' else 'ready_for_publication' end;
      perform public._set_submission_status(v_id, v_next, 'Internal review not required');
      if v_next = 'awaiting_client_approval' then
        perform public.notify_client_approvers(s.client_id, 'client_approval_requested',
          'Content awaiting your approval', s.code || ' · ' || coalesce(s.content_title, s.proposed_website),
          '/portal/approvals/' || v_id, v_id, 'client-review:' || v_id || ':' || s.current_version);
      end if;
    end if;

    perform public.notify_admins('submission_received', 'New submission ' || s.code,
      coalesce(public.current_actor_name(), 'An intern') || ' submitted ' || coalesce(s.content_title, s.proposed_website)
        || case when s.current_version > 1 then ' (revision v' || s.current_version || ')' else '' end,
      '/admin/submissions/' || v_id, 'submission', v_id, 'submitted:' || v_id || ':' || s.current_version);
    perform public.log_activity('submission.submitted', 'backlink_submissions', v_id::text, s.client_id,
      s.code || ' submitted (v' || s.current_version || ')', jsonb_build_object('version', s.current_version));
  end if;

  return v_id;
end;
$$;

create or replace function public.submission_admin_edit(p_id uuid, p_data jsonb, p_summary text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
  f record;
  v_new_version boolean;
begin
  perform public._require_admin();
  select * into s from public.backlink_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if s.status in ('published', 'verification_pending', 'verified_live', 'verification_failed', 'archived') then
    raise exception 'Published or archived submissions cannot be edited' using errcode = '22023';
  end if;
  if nullif(btrim(p_data ->> 'target_url'), '') is null or not public.is_http_url(btrim(p_data ->> 'target_url')) then
    raise exception 'A valid target URL is required' using errcode = '22023';
  end if;

  update public.backlink_submissions set
    proposed_website = coalesce(nullif(btrim(p_data ->> 'proposed_website'), ''), proposed_website),
    proposed_domain = coalesce(public.url_domain(nullif(btrim(p_data ->> 'proposed_website'), '')), proposed_domain),
    placement_url = nullif(btrim(p_data ->> 'placement_url'), ''),
    target_url = btrim(p_data ->> 'target_url'),
    anchor_text = nullif(btrim(p_data ->> 'anchor_text'), ''),
    content_title = nullif(btrim(p_data ->> 'content_title'), ''),
    content_draft = nullif(p_data ->> 'content_draft', ''),
    notes = nullif(p_data ->> 'notes', ''),
    link_attribute = nullif(p_data ->> 'link_attribute', '')::public.link_attribute
  where id = p_id;

  -- Drafts are not versioned until the intern submits them.
  if s.status = 'draft' then
    return;
  end if;
  v_new_version := public._snapshot_submission(p_id, coalesce(nullif(btrim(p_summary), ''), 'Edited by Super Admin'));
  if not v_new_version then
    return;
  end if;
  perform public.log_activity('submission.admin_edited', 'backlink_submissions', p_id::text, s.client_id,
    s.code || ' content edited by Super Admin (v' || (s.current_version + 1) || ')',
    jsonb_build_object('summary', p_summary));

  select * into f from public.campaign_flags(s.campaign_id);
  if s.status in ('client_approved', 'ready_for_publication') and f.require_client_approval
     and f.reapproval_on_material_change then
    perform public._set_submission_status(p_id, 'awaiting_client_approval',
      'Material change after approval; re-approval required');
    perform public.notify_client_approvers(s.client_id, 'client_reapproval_requested', 'Revised content needs approval',
      s.code || ' was revised after your approval', '/portal/approvals/' || p_id, p_id,
      'client-review:' || p_id || ':' || (s.current_version + 1));
  elsif s.status = 'awaiting_client_approval' then
    perform public.notify_client_approvers(s.client_id, 'client_approval_requested', 'Content updated for review',
      s.code || ' was updated to version ' || (s.current_version + 1), '/portal/approvals/' || p_id, p_id,
      'client-review:' || p_id || ':' || (s.current_version + 1));
  end if;
end;
$$;

create or replace function public.submission_mark_ready(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
  f record;
begin
  perform public._require_admin();
  select * into s from public.backlink_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  select * into f from public.campaign_flags(s.campaign_id);
  if not (s.status = 'client_approved'
          or (s.status = 'internally_approved' and not f.require_client_approval)) then
    raise exception 'Submission needs the required approvals before publication' using errcode = '22023';
  end if;
  perform public._set_submission_status(p_id, 'ready_for_publication', null);
  perform public.notify(s.intern_id, 'ready_for_publication', s.code || ' is ready for publication',
    'Publish the approved content and record the live URL', '/intern/submissions/' || p_id, 'submission', p_id,
    'ready:' || p_id || ':' || s.current_version);
end;
$$;

create or replace function public._submission_record_publication_impl(
  p_id uuid, p_published_url text, p_publication_date date, p_link_attribute public.link_attribute,
  p_anchor_text text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
  f record;
  v_norm text := public.normalize_url(p_published_url);
  v_norm_target text;
  v_existing text;
  v_pub_id uuid;
begin
  select * into s from public.backlink_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if not (public.is_super_admin() or (public.auth_role() = 'intern' and s.intern_id = auth.uid())) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if s.status not in ('client_approved', 'ready_for_publication') then
    raise exception 'Only approved submissions can be marked as published (status: %)', s.status
      using errcode = '22023';
  end if;
  select * into f from public.campaign_flags(s.campaign_id);
  if f.require_client_approval and not exists (
    select 1 from public.client_approvals
    where submission_id = p_id and version = s.current_version and decision = 'approved') then
    raise exception 'The current content version (v%) has no recorded approval', s.current_version
      using errcode = '22023';
  end if;
  if not public.is_http_url(btrim(p_published_url)) then
    raise exception 'Published URL is not a valid http(s) URL' using errcode = '22023';
  end if;
  if p_publication_date is null or p_publication_date > current_date + 1 then
    raise exception 'Publication date is invalid' using errcode = '22023';
  end if;

  v_norm_target := public.normalize_url(s.target_url);
  select bs.code into v_existing
  from public.published_backlinks pb join public.backlink_submissions bs on bs.id = pb.submission_id
  where pb.normalized_published_url = v_norm and pb.normalized_target_url = v_norm_target;
  if v_existing is not null then
    raise exception 'This placement is already recorded as published under %', v_existing using errcode = '23505';
  end if;

  insert into public.published_backlinks (submission_id, client_id, campaign_id, intern_id, backlink_type_id,
    published_url, normalized_published_url, publisher_domain, target_url, normalized_target_url, anchor_text,
    link_attribute, publication_date, recorded_by)
  values (p_id, s.client_id, s.campaign_id, s.intern_id, s.backlink_type_id, btrim(p_published_url), v_norm,
    public.url_domain(p_published_url), s.target_url, v_norm_target,
    coalesce(nullif(btrim(p_anchor_text), ''), s.anchor_text), coalesce(p_link_attribute, 'unknown'),
    p_publication_date, auth.uid())
  returning id into v_pub_id;

  perform public._set_submission_status(p_id, 'published', null);
  perform public._set_submission_status(p_id, 'verification_pending', null);
  update public.tasks set status = 'completed'
    where id = s.task_id and cadence = 'one_off' and status not in ('cancelled', 'completed')
      and (select count(*) from public.backlink_submissions b
           where b.task_id = s.task_id
             and b.status in ('published', 'verification_pending', 'verified_live')) >= target_quantity;

  perform public.notify_admins('backlink_published', s.code || ' published',
    'Live on ' || public.url_domain(p_published_url), '/admin/published?q=' || s.code, 'submission', p_id,
    'published:' || p_id);
  if (public.client_portal_settings(s.client_id) ->> 'show_published_backlinks')::boolean then
    perform public.notify_client_approvers(s.client_id, 'backlink_published', 'New backlink published',
      coalesce(s.content_title, s.proposed_website) || ' is now live', '/portal/published', p_id, 'published:' || p_id);
  end if;
  perform public.log_activity('submission.published', 'backlink_submissions', p_id::text, s.client_id,
    s.code || ' published at ' || btrim(p_published_url), '{}'::jsonb);
  return v_pub_id;
end;
$$;

drop function public._snapshot_submission(uuid, text, boolean, integer);
drop function public._client_approval_covers_current(uuid);
drop function public._submission_snapshot(public.backlink_submissions);

revoke execute on function
  public._submission_material(public.backlink_submissions),
  public._snapshot_submission(uuid, text),
  public._submission_save_impl(uuid, jsonb, boolean),
  public._submission_record_publication_impl(uuid, text, date, public.link_attribute, text)
from public, anon, authenticated;
