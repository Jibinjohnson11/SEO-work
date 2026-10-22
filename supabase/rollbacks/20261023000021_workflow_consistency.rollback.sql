-- Rollback for 20261023000021_workflow_consistency.sql: restores the previous function definitions and
-- drops the functions it added. The two new columns are deliberately KEPT (nullable / defaulted and ignored
-- by the old code): dropping them would erase which submissions use approved content and which content
-- decisions were admin overrides. Submissions linked to content then follow the normal client approval
-- again (the old functions read campaign_flags only).

drop function if exists public.campaign_sync_relations(uuid, uuid[], uuid, uuid[], uuid[]);
drop function if exists public.offpage_content_admin_decision(uuid, public.review_decision, text, integer);

-- campaign_flags (as in 20261016000015_tenant_scoped_settings.sql)
create or replace function public.campaign_flags(p_campaign_id uuid)
returns table (is_medical boolean, require_internal_review boolean, require_client_approval boolean,
               reapproval_on_material_change boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(c.is_medical, cl.is_medical),
         coalesce(c.require_internal_review, cl.require_internal_review),
         coalesce(c.require_client_approval, cl.require_client_approval),
         cl.reapproval_on_material_change
  from public.campaigns c
  join public.clients cl on cl.id = c.client_id
  where c.id = p_campaign_id
    and (public.is_super_admin()
         or public.is_trusted_backend()
         or c.id in (select public.my_campaign_ids())
         or c.client_id in (select public.my_client_ids())
         or exists (select 1 from public.backlink_submissions s
                    where s.campaign_id = c.id and s.intern_id = auth.uid() and public.auth_role() = 'intern'))
$$;

-- _submission_save_impl (as in 20261019000016_submission_versioning.sql)
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
  -- Versioning (20261019000016): a resubmission after requested changes always creates a version.
  v_force boolean := false;
  v_version integer;
  v_change text;
  v_label text;
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
    v_force := s.status in ('internal_changes_requested', 'client_changes_requested');
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
    v_version := public._snapshot_submission(v_id, nullif(btrim(p_data ->> 'change_summary'), ''), v_force);
    select change_type into v_change from public.submission_versions
      where submission_id = v_id and version = v_version;
    v_label := case v_change when 'minor' then ', minor revision' when 'unchanged' then ', resubmitted without changes'
      when 'material' then ', material change' else '' end;
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
        || case when s.current_version > 1 then ' (revision v' || s.current_version || v_label || ')' else '' end,
      '/admin/submissions/' || v_id, 'submission', v_id, 'submitted:' || v_id || ':' || s.current_version);
    perform public.log_activity('submission.submitted', 'backlink_submissions', v_id::text, s.client_id,
      s.code || ' submitted (v' || s.current_version || v_label || ')',
      jsonb_build_object('version', s.current_version, 'change_type', v_change));
  end if;

  return v_id;
end;
$$;

-- submission_admin_edit (as in 20261019000016_submission_versioning.sql)
create or replace function public.submission_admin_edit(p_id uuid, p_data jsonb, p_summary text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
  f record;
  v_new_version integer;
  v_carry integer;
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
  select * into f from public.campaign_flags(s.campaign_id);
  -- When the campaign does not require re-approval, an approval given before this edit is carried
  -- forward EXPLICITLY: the new version records which approved version it relies on.
  if s.status in ('client_approved', 'ready_for_publication') and f.require_client_approval
     and not f.reapproval_on_material_change then
    v_carry := coalesce(s.client_approved_version, (select max(a.version) from public.client_approvals a
      where a.submission_id = p_id and a.decision = 'approved'));
  end if;
  v_new_version := public._snapshot_submission(p_id, coalesce(nullif(btrim(p_summary), ''), 'Edited by Super Admin'),
    false, v_carry);
  if v_new_version = 0 then
    return;
  end if;
  perform public.log_activity('submission.admin_edited', 'backlink_submissions', p_id::text, s.client_id,
    s.code || ' content edited by Super Admin (v' || v_new_version || ')'
      || case when v_carry is not null then '; client approval of v' || v_carry
        || ' carried forward (re-approval not required by campaign setting)' else '' end,
    jsonb_build_object('summary', p_summary, 'version', v_new_version, 'approval_carried_from', v_carry));

  if s.status in ('client_approved', 'ready_for_publication') and f.require_client_approval
     and f.reapproval_on_material_change then
    perform public._set_submission_status(p_id, 'awaiting_client_approval',
      'Material change after approval; re-approval required');
    perform public.notify_client_approvers(s.client_id, 'client_reapproval_requested', 'Revised content needs approval',
      s.code || ' was revised after your approval', '/portal/approvals/' || p_id, p_id,
      'client-review:' || p_id || ':' || v_new_version);
  elsif s.status = 'awaiting_client_approval' then
    perform public.notify_client_approvers(s.client_id, 'client_approval_requested', 'Content updated for review',
      s.code || ' was updated to version ' || v_new_version, '/portal/approvals/' || p_id, p_id,
      'client-review:' || p_id || ':' || v_new_version);
  end if;
end;
$$;

-- submission_mark_ready (as in 20261019000016_submission_versioning.sql)
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
  if f.require_client_approval and not public._client_approval_covers_current(p_id) then
    raise exception 'The current content version (v%) has no client approval. Send it to the client for re-approval.',
      s.current_version using errcode = '22023';
  end if;
  perform public._set_submission_status(p_id, 'ready_for_publication', null);
  perform public.notify(s.intern_id, 'ready_for_publication', s.code || ' is ready for publication',
    'Publish the approved content and record the live URL', '/intern/submissions/' || p_id, 'submission', p_id,
    'ready:' || p_id || ':' || s.current_version);
end;
$$;

-- _submission_record_publication_impl (as in 20261019000016_submission_versioning.sql)
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
  if f.require_client_approval and not public._client_approval_covers_current(p_id) then
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

-- submission_send_to_client (as in 20261012000003_workflow.sql)
create or replace function public.submission_send_to_client(p_id uuid)
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
  if s.status <> 'internally_approved' then
    raise exception 'Only internally approved submissions can be sent to the client' using errcode = '22023';
  end if;
  select * into f from public.campaign_flags(s.campaign_id);
  if not f.require_client_approval then
    perform public._set_submission_status(p_id, 'ready_for_publication', 'Client approval not required');
    return;
  end if;
  perform public._set_submission_status(p_id, 'awaiting_client_approval', null);
  perform public.notify_client_approvers(s.client_id, 'client_approval_requested', 'Content awaiting your approval',
    s.code || ' · ' || coalesce(s.content_title, s.proposed_website), '/portal/approvals/' || p_id, p_id,
    'client-review:' || p_id || ':' || s.current_version);
  perform public.notify(s.intern_id, 'sent_to_client', s.code || ' sent to client',
    'Your submission was forwarded for client approval', '/intern/submissions/' || p_id, 'submission', p_id,
    'sent-to-client:' || p_id || ':' || s.current_version);
  perform public.log_activity('submission.sent_to_client', 'backlink_submissions', p_id::text, s.client_id,
    s.code || ' sent for client approval (v' || s.current_version || ')', '{}'::jsonb);
end;
$$;

-- submission_internal_decision (as in 20261012000003_workflow.sql)
create or replace function public.submission_internal_decision(
  p_id uuid,
  p_decision public.review_decision,
  p_comments text,
  p_checklist jsonb default '{}'::jsonb,
  p_medical jsonb default null,
  p_forward boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
  f record;
  v_medical_required boolean;
begin
  perform public._require_admin();
  select * into s from public.backlink_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if s.status not in ('submitted', 'internal_review') then
    raise exception 'Submission is not awaiting internal review (status: %)', s.status using errcode = '22023';
  end if;
  if p_decision <> 'approved' and nullif(btrim(p_comments), '') is null then
    raise exception 'Feedback is required when requesting changes or rejecting' using errcode = '22023';
  end if;

  select * into f from public.campaign_flags(s.campaign_id);
  v_medical_required := f.is_medical
    and coalesce((public.get_setting('approval') ->> 'medical_review_required')::boolean, true);
  if p_decision = 'approved' and v_medical_required then
    if p_medical is null
       or coalesce((p_medical ->> 'medical_accuracy_reviewed')::boolean, false) is not true
       or coalesce((p_medical ->> 'claims_verified')::boolean, false) is not true
       or coalesce((p_medical ->> 'sources_checked')::boolean, false) is not true
       or nullif(btrim(p_medical ->> 'medical_reviewer_name'), '') is null then
      raise exception 'Medical review checklist must be completed before approving medical content'
        using errcode = '22023';
    end if;
  end if;

  insert into public.internal_reviews (submission_id, version, reviewer_id, reviewer_name, decision, comments, checklist,
    medical_accuracy_reviewed, medical_reviewer_name, medical_reviewer_qualification, claims_verified, sources_checked,
    compliance_notes, medical_review_date)
  values (p_id, s.current_version, auth.uid(), coalesce(public.current_actor_name(), 'Super Admin'), p_decision,
    nullif(btrim(p_comments), ''), coalesce(p_checklist, '{}'::jsonb),
    (p_medical ->> 'medical_accuracy_reviewed')::boolean, nullif(btrim(p_medical ->> 'medical_reviewer_name'), ''),
    nullif(btrim(p_medical ->> 'medical_reviewer_qualification'), ''), (p_medical ->> 'claims_verified')::boolean,
    (p_medical ->> 'sources_checked')::boolean, nullif(btrim(p_medical ->> 'compliance_notes'), ''),
    coalesce(nullif(p_medical ->> 'medical_review_date', '')::date,
             case when p_medical is not null then current_date end));

  if p_decision = 'approved' then
    perform public._set_submission_status(p_id, 'internally_approved', nullif(btrim(p_comments), ''));
    update public.tasks set status = 'in_progress' where id = s.task_id and status in ('under_review', 'changes_requested');
    perform public.notify(s.intern_id, 'internal_approved', s.code || ' approved internally',
      coalesce(nullif(btrim(p_comments), ''), 'Your submission passed internal review'),
      '/intern/submissions/' || p_id, 'submission', p_id, 'internal-decision:' || p_id || ':' || s.current_version);
    perform public.log_activity('submission.internally_approved', 'backlink_submissions', p_id::text, s.client_id,
      s.code || ' approved internally (v' || s.current_version || ')', '{}'::jsonb);
    if p_forward or not f.require_client_approval then
      perform public.submission_send_to_client(p_id);
    end if;
  elsif p_decision = 'changes_requested' then
    perform public._set_submission_status(p_id, 'internal_changes_requested', btrim(p_comments));
    update public.tasks set status = 'changes_requested' where id = s.task_id and status not in ('completed', 'cancelled');
    perform public.notify(s.intern_id, 'internal_changes_requested', 'Changes requested on ' || s.code, btrim(p_comments),
      '/intern/submissions/' || p_id, 'submission', p_id, 'internal-decision:' || p_id || ':' || s.current_version);
    perform public.log_activity('submission.internal_changes_requested', 'backlink_submissions', p_id::text,
      s.client_id, s.code || ' returned for changes', '{}'::jsonb);
  else
    perform public._set_submission_status(p_id, 'internal_rejected', btrim(p_comments));
    perform public.notify(s.intern_id, 'internal_rejected', s.code || ' was rejected', btrim(p_comments),
      '/intern/submissions/' || p_id, 'submission', p_id, 'internal-decision:' || p_id || ':' || s.current_version);
    perform public.log_activity('submission.internal_rejected', 'backlink_submissions', p_id::text, s.client_id,
      s.code || ' rejected internally', '{}'::jsonb);
  end if;
end;
$$;

-- tasks_check_assignment (as in 20261012000003_workflow.sql)
create or replace function public.tasks_check_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = new.intern_id and role = 'intern') then
    raise exception 'Tasks can only be assigned to interns' using errcode = '23514';
  end if;
  insert into public.intern_assignments (campaign_id, intern_id, assigned_by)
  values (new.campaign_id, new.intern_id, auth.uid())
  on conflict (campaign_id, intern_id) do update set is_active = true;
  return new;
end;
$$;

-- offpage_content_submit (as in 20261021000019_offpage_content.sql)
create or replace function public.offpage_content_submit(p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.auth_role();
  v_campaign uuid := nullif(p_data ->> 'campaign_id', '')::uuid;
  v_keyword uuid := nullif(p_data ->> 'keyword_id', '')::uuid;
  v_type uuid := nullif(p_data ->> 'backlink_type_id', '')::uuid;
  v_ctype text := p_data ->> 'content_type';
  v_title text := btrim(coalesce(p_data ->> 'title', ''));
  v_html text := coalesce(p_data ->> 'content_html', '');
  c public.offpage_contents;
  v_id uuid;
  r record;
begin
  if v_role = 'intern' then
    perform public._require_permission(array['intern.content']);
  elsif v_role is distinct from 'super_admin' then
    raise exception 'You do not have permission to submit content' using errcode = '42501';
  end if;
  if v_campaign is null or not exists (select 1 from public.campaigns where id = v_campaign) then
    raise exception 'Select a campaign' using errcode = '22023';
  end if;
  if v_role = 'intern' and v_campaign not in (select public.my_campaign_ids()) then
    raise exception 'You are not assigned to this campaign' using errcode = '42501';
  end if;
  if v_type is null or not exists (select 1 from public.backlink_types where id = v_type) then
    raise exception 'Select a backlink type' using errcode = '22023';
  end if;
  if exists (select 1 from public.campaign_backlink_types where campaign_id = v_campaign)
     and not exists (select 1 from public.campaign_backlink_types where campaign_id = v_campaign and backlink_type_id = v_type) then
    raise exception 'That backlink type is not used by this campaign' using errcode = '22023';
  end if;
  if v_title = '' or btrim(v_html) = '' then
    raise exception 'Content title and content are required' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.offpage_contents (campaign_id, keyword_id, backlink_type_id, content_type, title, content_html, submitted_by)
    values (v_campaign, v_keyword, v_type, v_ctype, v_title, v_html, auth.uid())
    returning * into c;
  else
    select * into c from public.offpage_contents where id = p_id for update;
    if not found or (v_role = 'intern' and c.submitted_by is distinct from auth.uid()) then
      raise exception 'Content not found' using errcode = 'P0002';
    end if;
    if c.status not in ('awaiting_client_approval', 'changes_requested') then
      raise exception 'Approved or rejected content can no longer be changed' using errcode = '22023';
    end if;
    update public.offpage_contents set
      campaign_id = v_campaign, keyword_id = v_keyword, backlink_type_id = v_type, content_type = v_ctype,
      title = v_title, content_html = v_html, status = 'awaiting_client_approval',
      current_version = c.current_version + 1, submitted_at = now(), updated_by = auth.uid()
    where id = p_id
    returning * into c;
  end if;
  v_id := c.id;

  insert into public.offpage_content_versions (content_id, version, campaign_id, keyword_id, backlink_type_id,
    content_type, title, content_html, submitted_by)
  values (v_id, c.current_version, c.campaign_id, c.keyword_id, c.backlink_type_id, c.content_type, c.title,
    c.content_html, auth.uid());

  for r in
    select cm.user_id from public.client_members cm
    join public.profiles p on p.id = cm.user_id
    where cm.client_id = c.client_id and cm.can_approve and p.status = 'active' and p.role = 'client'
  loop
    perform public.notify(r.user_id, 'content_approval_requested', 'Content awaiting your approval',
      c.code || ' · ' || c.title, '/portal/approvals/content/' || v_id, 'offpage_content', v_id,
      'content-review:' || v_id || ':' || c.current_version);
  end loop;
  perform public.notify_admins('content_submitted', 'Content ' || c.code || ' sent for client approval',
    coalesce(public.current_actor_name(), 'A team member') || ' submitted "' || c.title || '"'
      || case when c.current_version > 1 then ' (version ' || c.current_version || ')' else '' end,
    '/admin/page-content?q=' || c.code, 'offpage_content', v_id, 'content-submitted:' || v_id || ':' || c.current_version);
  perform public.log_activity('offpage_content.submitted', 'offpage_contents', v_id::text, c.client_id,
    c.code || ' submitted for client approval (v' || c.current_version || ')',
    jsonb_build_object('version', c.current_version));
  return v_id;
end;
$$;

-- client_portal_offpage_content (as in 20261021000019_offpage_content.sql)
create or replace function public.client_portal_offpage_content(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.offpage_contents;
begin
  perform public._require_client();
  perform public._require_permission(array['portal.approvals']);
  select * into o from public.offpage_contents where id = p_id and client_id in (select public.my_client_ids());
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', o.id, 'code', o.code, 'status', o.status, 'title', o.title, 'content_html', o.content_html,
    'content_type', o.content_type, 'current_version', o.current_version, 'approved_version', o.approved_version,
    'submitted_at', o.submitted_at,
    'campaign', (select jsonb_build_object('code', c.code, 'name', c.name) from public.campaigns c where c.id = o.campaign_id),
    'keyword', (select k.keyword from public.keywords k where k.id = o.keyword_id),
    'backlink_type', (select bt.name from public.backlink_types bt where bt.id = o.backlink_type_id),
    'can_approve', exists (select 1 from public.client_members cm
                           where cm.client_id = o.client_id and cm.user_id = auth.uid() and cm.can_approve),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', v.version, 'title', v.title,
                   'content_html', v.content_html, 'created_at', v.created_at) order by v.version desc)
                 from public.offpage_content_versions v where v.content_id = o.id), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('version', d.version, 'decision', d.decision,
                    'feedback', d.feedback, 'decided_by_name', d.decided_by_name, 'created_at', d.created_at)
                    order by d.created_at desc)
                  from public.offpage_content_decisions d where d.content_id = o.id), '[]'::jsonb)
  );
end;
$$;

-- Dropped last: the restored functions no longer call it.
drop function if exists public.submission_flags(uuid);
