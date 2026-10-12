-- Reporting view and client portal read functions.

-- One row per (submission, milestone), at the first time the milestone was reached.
-- Revisions, re-reviews and repeated verification never produce a second row.
create view public.report_events
with (security_invoker = true)
as
select distinct on (e.submission_id, m.metric)
  e.submission_id,
  m.metric,
  e.occurred_at,
  s.client_id,
  s.campaign_id,
  s.keyword_id,
  s.intern_id,
  s.backlink_type_id,
  s.task_id
from public.submission_events e
join public.backlink_submissions s on s.id = e.submission_id
cross join lateral (
  select case e.to_status
    when 'submitted' then 'submitted'
    when 'internally_approved' then 'internally_approved'
    when 'client_approved' then 'client_approved'
    when 'internal_rejected' then 'rejected'
    when 'client_rejected' then 'rejected'
    when 'published' then 'published'
    when 'verified_live' then 'verified_live'
  end as metric
) m
where m.metric is not null
order by e.submission_id, m.metric, e.occurred_at;

grant select on public.report_events to authenticated;

-- ---------------------------------------------------------------------------
-- Client portal. Client users have no direct access to internal tables; these functions
-- return only client-safe columns for workspaces they belong to, honouring portal settings.
-- ---------------------------------------------------------------------------
create or replace function public._require_client()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.auth_role() is distinct from 'client' then
    raise exception 'Client access required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.client_portal_clients()
returns table (id uuid, code text, company_name text, website_url text, timezone text, settings jsonb,
               can_approve boolean, can_download_reports boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public._require_client();
  return query
  select c.id, c.code, c.company_name, c.website_url, c.timezone, public.client_portal_settings(c.id),
         cm.can_approve, cm.can_download_reports
  from public.clients c
  join public.client_members cm on cm.client_id = c.id and cm.user_id = auth.uid()
  where c.status <> 'archived'
  order by c.company_name;
end;
$$;

create or replace function public.client_portal_campaigns()
returns table (
  id uuid, code text, name text, client_id uuid, client_name text, status public.campaign_status,
  priority public.priority_level, start_date date, end_date date, target_url text, monthly_target integer,
  primary_keyword text, keywords text[], month_submitted integer, month_client_approved integer,
  month_published integer, month_verified integer, awaiting_approval integer, total_published integer,
  total_verified integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public._require_client();
  return query
  with mine as (select public.my_client_ids() as cid),
  base as (
    select c.*, cl.company_name, cl.timezone as tz, public.client_portal_settings(c.client_id) as ps,
           date_trunc('month', now() at time zone cl.timezone) at time zone cl.timezone as month_start
    from public.campaigns c
    join public.clients cl on cl.id = c.client_id
    where c.client_id in (select m.cid from mine m) and c.status in ('active', 'paused', 'completed')
  )
  select b.id, b.code, b.name, b.client_id, b.company_name, b.status, b.priority, b.start_date, b.end_date,
    b.target_url,
    case when (b.ps ->> 'show_target_counts')::boolean then b.monthly_target end,
    (select k.keyword from public.campaign_keywords ck join public.keywords k on k.id = ck.keyword_id
      where ck.campaign_id = b.id and ck.is_primary limit 1),
    array(select k.keyword from public.campaign_keywords ck join public.keywords k on k.id = ck.keyword_id
      where ck.campaign_id = b.id order by ck.is_primary desc, k.keyword),
    case when (b.ps ->> 'show_campaign_progress')::boolean then
      (select count(*)::integer from public.report_events_all(b.id) r where r.metric = 'submitted' and r.occurred_at >= b.month_start) end,
    case when (b.ps ->> 'show_campaign_progress')::boolean then
      (select count(*)::integer from public.report_events_all(b.id) r where r.metric = 'client_approved' and r.occurred_at >= b.month_start) end,
    case when (b.ps ->> 'show_campaign_progress')::boolean then
      (select count(*)::integer from public.report_events_all(b.id) r where r.metric = 'published' and r.occurred_at >= b.month_start) end,
    case when (b.ps ->> 'show_campaign_progress')::boolean then
      (select count(*)::integer from public.report_events_all(b.id) r where r.metric = 'verified_live' and r.occurred_at >= b.month_start) end,
    (select count(*)::integer from public.backlink_submissions s
      where s.campaign_id = b.id and s.status = 'awaiting_client_approval'),
    case when (b.ps ->> 'show_published_backlinks')::boolean then
      (select count(*)::integer from public.published_backlinks pb where pb.campaign_id = b.id) end,
    case when (b.ps ->> 'show_published_backlinks')::boolean then
      (select count(*)::integer from public.published_backlinks pb
        where pb.campaign_id = b.id and pb.live_status in ('live', 'changed')) end
  from base b
  order by b.code;
end;
$$;

-- Milestone events for one campaign, ignoring RLS (only called from definer functions).
create or replace function public.report_events_all(p_campaign_id uuid)
returns table (submission_id uuid, metric text, occurred_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (e.submission_id, m.metric) e.submission_id, m.metric, e.occurred_at
  from public.submission_events e
  join public.backlink_submissions s on s.id = e.submission_id
  cross join lateral (
    select case e.to_status
      when 'submitted' then 'submitted' when 'internally_approved' then 'internally_approved'
      when 'client_approved' then 'client_approved' when 'internal_rejected' then 'rejected'
      when 'client_rejected' then 'rejected' when 'published' then 'published'
      when 'verified_live' then 'verified_live' end as metric) m
  where s.campaign_id = p_campaign_id and m.metric is not null
  order by e.submission_id, m.metric, e.occurred_at
$$;

-- Statuses a client can see. Internal stages (drafts, internal review, internal rejection) stay private.
create or replace function public.client_visible_status(p_status public.submission_status)
returns boolean
language sql
immutable
as $$
  select p_status in ('awaiting_client_approval', 'client_changes_requested', 'client_approved', 'client_rejected',
                      'ready_for_publication', 'published', 'verification_pending', 'verified_live',
                      'verification_failed')
$$;

create or replace function public.client_portal_submissions(p_queue_only boolean default false)
returns table (
  id uuid, code text, client_id uuid, campaign_code text, campaign_name text, keyword text, backlink_type text,
  proposed_website text, placement_url text, target_url text, anchor_text text, content_title text,
  status public.submission_status, current_version integer, client_approved_version integer,
  submitted_at timestamptz, sent_to_client_at timestamptz, last_decision public.review_decision,
  last_decision_at timestamptz, domain_rating numeric, domain_authority numeric, intern_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public._require_client();
  return query
  select s.id, s.code, s.client_id, c.code, c.name, k.keyword, bt.name, s.proposed_website, s.placement_url,
    s.target_url, s.anchor_text, s.content_title, s.status, s.current_version, s.client_approved_version,
    s.first_submitted_at,
    (select max(e.occurred_at) from public.submission_events e
      where e.submission_id = s.id and e.to_status = 'awaiting_client_approval'),
    ca.decision, ca.created_at,
    case when (public.client_portal_settings(s.client_id) ->> 'show_domain_metrics')::boolean then s.domain_rating end,
    case when (public.client_portal_settings(s.client_id) ->> 'show_domain_metrics')::boolean then s.domain_authority end,
    case when (public.client_portal_settings(s.client_id) ->> 'show_intern_names')::boolean then p.full_name end
  from public.backlink_submissions s
  join public.campaigns c on c.id = s.campaign_id
  join public.backlink_types bt on bt.id = s.backlink_type_id
  join public.profiles p on p.id = s.intern_id
  left join public.keywords k on k.id = s.keyword_id
  left join lateral (
    select x.decision, x.created_at from public.client_approvals x
    where x.submission_id = s.id order by x.created_at desc limit 1) ca on true
  where s.client_id in (select public.my_client_ids())
    and public.client_visible_status(s.status)
    and (not p_queue_only or s.status = 'awaiting_client_approval')
  order by coalesce((select max(e.occurred_at) from public.submission_events e
                     where e.submission_id = s.id and e.to_status = 'awaiting_client_approval'), s.created_at) desc;
end;
$$;

create or replace function public.client_portal_submission(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
  v jsonb;
begin
  perform public._require_client();
  select * into s from public.backlink_submissions where id = p_id;
  if not found or s.client_id not in (select public.my_client_ids()) or not public.client_visible_status(s.status) then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'id', s.id, 'code', s.code, 'status', s.status, 'current_version', s.current_version,
    'client_approved_version', s.client_approved_version,
    'campaign', (select jsonb_build_object('code', c.code, 'name', c.name) from public.campaigns c where c.id = s.campaign_id),
    'keyword', (select k.keyword from public.keywords k where k.id = s.keyword_id),
    'backlink_type', (select bt.name from public.backlink_types bt where bt.id = s.backlink_type_id),
    'proposed_website', s.proposed_website, 'placement_url', s.placement_url, 'target_url', s.target_url,
    'anchor_text', s.anchor_text, 'content_title', s.content_title, 'content_draft', s.content_draft,
    'link_attribute', s.link_attribute, 'submitted_at', s.first_submitted_at,
    'domain_rating', case when (public.client_portal_settings(s.client_id) ->> 'show_domain_metrics')::boolean
                          then s.domain_rating end,
    'domain_authority', case when (public.client_portal_settings(s.client_id) ->> 'show_domain_metrics')::boolean
                             then s.domain_authority end,
    'can_approve', exists (select 1 from public.client_members cm
                           where cm.client_id = s.client_id and cm.user_id = auth.uid() and cm.can_approve),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', sv.version, 'snapshot', sv.snapshot,
                            'created_at', sv.created_at, 'change_summary', sv.change_summary) order by sv.version desc)
                          from public.submission_versions sv where sv.submission_id = s.id), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('version', ca.version, 'decision', ca.decision,
                             'feedback', ca.feedback, 'decided_by_name', ca.decided_by_name,
                             'is_admin_override', ca.is_admin_override, 'created_at', ca.created_at)
                             order by ca.created_at desc)
                           from public.client_approvals ca where ca.submission_id = s.id), '[]'::jsonb),
    'published', (select jsonb_build_object('published_url', pb.published_url, 'publication_date', pb.publication_date,
                    'live_status', pb.live_status, 'last_checked_at', pb.last_checked_at)
                  from public.published_backlinks pb where pb.submission_id = s.id)
  ) into v;
  return v;
end;
$$;

create or replace function public.client_portal_published()
returns table (
  id uuid, submission_code text, campaign_code text, campaign_name text, backlink_type text, published_url text,
  publisher_domain text, target_url text, anchor_text text, link_attribute public.link_attribute,
  publication_date date, live_status public.live_status, last_checked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public._require_client();
  return query
  select pb.id, s.code, c.code, c.name, bt.name, pb.published_url, pb.publisher_domain, pb.target_url, pb.anchor_text,
    pb.link_attribute, pb.publication_date, pb.live_status, pb.last_checked_at
  from public.published_backlinks pb
  join public.backlink_submissions s on s.id = pb.submission_id
  join public.campaigns c on c.id = pb.campaign_id
  join public.backlink_types bt on bt.id = pb.backlink_type_id
  where pb.client_id in (select public.my_client_ids())
    and (public.client_portal_settings(pb.client_id) ->> 'show_published_backlinks')::boolean
    and s.status <> 'archived'
  order by pb.publication_date desc;
end;
$$;

revoke execute on function public.report_events_all(uuid), public._require_client() from public, anon, authenticated;
grant execute on function
  public.client_visible_status(public.submission_status), public.client_portal_clients(),
  public.client_portal_campaigns(), public.client_portal_submissions(boolean), public.client_portal_submission(uuid),
  public.client_portal_published()
to authenticated;

-- Publishing a report snapshot to its client workspace notifies that client's users.
create or replace function public.report_set_published(p_report_id uuid, p_published boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reports;
  m record;
begin
  perform public._require_admin();
  select * into r from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  if p_published and r.client_id is null then
    raise exception 'Only single-client reports can be published. Filter the report by client first.' using errcode = '22023';
  end if;
  if p_published and r.filters ->> 'group' = 'intern'
     and not (public.client_portal_settings(r.client_id) ->> 'show_intern_names')::boolean then
    raise exception 'This report is grouped by intern, but this client''s portal hides team member names.' using errcode = '22023';
  end if;
  update public.reports
    set status = case when p_published then 'published'::public.report_status else 'draft'::public.report_status end,
        published_at = case when p_published then now() end
    where id = p_report_id;
  if p_published then
    for m in
      select cm.user_id from public.client_members cm join public.profiles p on p.id = cm.user_id
      where cm.client_id = r.client_id and p.status = 'active'
    loop
      perform public.notify(m.user_id, 'report_published', 'New report available', r.title, '/portal/reports',
        'report', r.id, 'report:' || r.id);
    end loop;
  end if;
end;
$$;
grant execute on function public.report_set_published(uuid, boolean) to authenticated;
