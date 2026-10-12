-- LinkOps core schema
-- auth.users (managed by Supabase Auth) is the "users" table; public.profiles holds
-- application identity, role and status. Roles are never derived from user-editable metadata.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('super_admin', 'intern', 'client');
create type public.user_status as enum ('invited', 'active', 'disabled');
create type public.client_status as enum ('active', 'paused', 'archived');
create type public.campaign_status as enum ('draft', 'active', 'paused', 'completed', 'archived');
create type public.priority_level as enum ('low', 'medium', 'high', 'urgent');
create type public.record_status as enum ('active', 'paused', 'archived');
create type public.search_intent as enum ('informational', 'navigational', 'commercial', 'transactional', 'local');
create type public.task_cadence as enum ('one_off', 'daily', 'weekly', 'monthly');
create type public.task_status as enum (
  'not_started', 'in_progress', 'submitted', 'under_review', 'changes_requested', 'completed', 'cancelled'
);
create type public.submission_status as enum (
  'draft',
  'submitted',
  'internal_review',
  'internal_changes_requested',
  'internally_approved',
  'internal_rejected',
  'awaiting_client_approval',
  'client_changes_requested',
  'client_approved',
  'client_rejected',
  'ready_for_publication',
  'published',
  'verification_pending',
  'verified_live',
  'verification_failed',
  'archived'
);
create type public.review_decision as enum ('approved', 'changes_requested', 'rejected');
create type public.link_attribute as enum ('dofollow', 'nofollow', 'sponsored', 'ugc', 'unknown');
create type public.live_status as enum ('pending_verification', 'live', 'changed', 'missing', 'unreachable');
create type public.verification_result as enum ('live', 'changed', 'missing', 'unreachable', 'inconclusive');
create type public.verification_method as enum ('automated', 'manual');
create type public.outreach_status as enum (
  'not_contacted', 'contacted', 'follow_up', 'negotiating', 'accepted', 'declined'
);
create type public.report_kind as enum ('daily', 'weekly', 'monthly', 'custom');
create type public.report_status as enum ('draft', 'published');

-- ---------------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Roles & profiles
-- ---------------------------------------------------------------------------
create table public.roles (
  key public.app_role primary key,
  name text not null,
  description text not null default ''
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  email text not null,
  full_name text not null default '',
  role public.app_role not null,
  status public.user_status not null default 'invited',
  phone text,
  job_title text,
  avatar_url text,
  timezone text not null default 'Asia/Kolkata',
  joining_date date,
  daily_target integer not null default 0 check (daily_target >= 0),
  weekly_target integer not null default 0 check (weekly_target >= 0),
  monthly_target integer not null default 0 check (monthly_target >= 0),
  email_notifications boolean not null default true,
  last_sign_in_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_role_status_idx on public.profiles (role, status);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
create sequence public.client_code_seq;
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('CL-' || lpad(nextval('public.client_code_seq')::text, 3, '0')),
  company_name text not null check (length(trim(company_name)) > 0),
  website_url text,
  industry text,
  contact_person text,
  contact_email text,
  contact_phone text,
  country text,
  timezone text not null default 'Asia/Kolkata',
  start_date date,
  status public.client_status not null default 'active',
  notes text,
  is_medical boolean not null default false,
  require_internal_review boolean not null default true,
  require_client_approval boolean not null default true,
  reapproval_on_material_change boolean not null default true,
  -- What the client portal may show: see public.client_portal_settings() for keys/defaults.
  portal_settings jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index clients_status_idx on public.clients (status);
create trigger clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

create table public.client_members (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  can_approve boolean not null default true,
  can_download_reports boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, user_id)
);
create index client_members_user_idx on public.client_members (user_id);

-- ---------------------------------------------------------------------------
-- Backlink types
-- ---------------------------------------------------------------------------
create table public.backlink_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  -- Submission fields (beyond the always-required core) that interns must fill for this type.
  required_fields text[] not null default '{}',
  review_checklist jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index backlink_types_name_key on public.backlink_types (lower(name));
create trigger backlink_types_updated_at before update on public.backlink_types
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Campaigns & keywords
-- ---------------------------------------------------------------------------
create sequence public.campaign_code_seq;
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('CMP-' || lpad(nextval('public.campaign_code_seq')::text, 3, '0')),
  name text not null check (length(trim(name)) > 0),
  client_id uuid not null references public.clients (id) on delete restrict,
  description text,
  target_url text,
  priority public.priority_level not null default 'medium',
  start_date date,
  end_date date,
  daily_target integer not null default 0 check (daily_target >= 0),
  weekly_target integer not null default 0 check (weekly_target >= 0),
  monthly_target integer not null default 0 check (monthly_target >= 0),
  status public.campaign_status not null default 'draft',
  -- null = inherit from client
  is_medical boolean,
  require_internal_review boolean,
  require_client_approval boolean,
  internal_notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index campaigns_client_idx on public.campaigns (client_id);
create index campaigns_status_idx on public.campaigns (status);
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

create sequence public.keyword_code_seq;
create table public.keywords (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('KW-' || lpad(nextval('public.keyword_code_seq')::text, 4, '0')),
  keyword text not null check (length(trim(keyword)) > 0),
  client_id uuid not null references public.clients (id) on delete restrict,
  search_intent public.search_intent,
  target_url text,
  priority public.priority_level not null default 'medium',
  group_name text,
  notes text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index keywords_client_keyword_key on public.keywords (client_id, lower(keyword));
create index keywords_group_idx on public.keywords (group_name);
create trigger keywords_updated_at before update on public.keywords
  for each row execute function public.set_updated_at();

create table public.campaign_keywords (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  keyword_id uuid not null references public.keywords (id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (campaign_id, keyword_id)
);
create unique index campaign_keywords_one_primary on public.campaign_keywords (campaign_id) where is_primary;
create index campaign_keywords_keyword_idx on public.campaign_keywords (keyword_id);

-- Keywords may only be attached to campaigns of the same client.
create or replace function public.check_campaign_keyword_client()
returns trigger
language plpgsql
as $$
begin
  if (select client_id from public.campaigns where id = new.campaign_id)
     is distinct from (select client_id from public.keywords where id = new.keyword_id) then
    raise exception 'Keyword and campaign belong to different clients' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger campaign_keywords_client_check before insert or update on public.campaign_keywords
  for each row execute function public.check_campaign_keyword_client();

-- Allowed backlink types per campaign. A campaign with no rows allows every active type.
create table public.campaign_backlink_types (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  backlink_type_id uuid not null references public.backlink_types (id) on delete cascade,
  primary key (campaign_id, backlink_type_id)
);

-- ---------------------------------------------------------------------------
-- Intern assignments & tasks
-- ---------------------------------------------------------------------------
create table public.intern_assignments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  intern_id uuid not null references public.profiles (id) on delete restrict,
  is_active boolean not null default true,
  assigned_by uuid references public.profiles (id),
  assigned_at timestamptz not null default now(),
  unique (campaign_id, intern_id)
);
create index intern_assignments_intern_idx on public.intern_assignments (intern_id) where is_active;

create sequence public.task_code_seq;
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('TSK-' || lpad(nextval('public.task_code_seq')::text, 5, '0')),
  title text not null,
  intern_id uuid not null references public.profiles (id) on delete restrict,
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  client_id uuid not null references public.clients (id) on delete restrict,
  keyword_id uuid references public.keywords (id) on delete set null,
  backlink_type_id uuid references public.backlink_types (id) on delete set null,
  cadence public.task_cadence not null default 'daily',
  target_quantity integer not null default 1 check (target_quantity > 0),
  start_date date not null default current_date,
  due_date date,
  priority public.priority_level not null default 'medium',
  status public.task_status not null default 'not_started',
  instructions text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or due_date >= start_date)
);
create index tasks_intern_idx on public.tasks (intern_id, status);
create index tasks_campaign_idx on public.tasks (campaign_id);
create index tasks_due_idx on public.tasks (due_date);
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- Tasks inherit client from campaign and keyword must belong to that campaign's client.
create or replace function public.tasks_derive_client()
returns trigger
language plpgsql
as $$
begin
  select client_id into new.client_id from public.campaigns where id = new.campaign_id;
  if new.keyword_id is not null
     and (select client_id from public.keywords where id = new.keyword_id) is distinct from new.client_id then
    raise exception 'Keyword does not belong to the campaign client' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger tasks_derive_client before insert or update of campaign_id, keyword_id on public.tasks
  for each row execute function public.tasks_derive_client();

-- ---------------------------------------------------------------------------
-- Backlink submissions
-- ---------------------------------------------------------------------------
create sequence public.submission_code_seq;
create table public.backlink_submissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('SUB-' || lpad(nextval('public.submission_code_seq')::text, 6, '0')),
  client_id uuid not null references public.clients (id) on delete restrict,
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  keyword_id uuid references public.keywords (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  intern_id uuid not null references public.profiles (id) on delete restrict,
  backlink_type_id uuid not null references public.backlink_types (id) on delete restrict,
  proposed_website text not null,
  proposed_domain text not null,
  placement_url text,
  target_url text not null,
  anchor_text text,
  content_title text,
  content_draft text,
  notes text,
  domain_rating numeric(5, 2) check (domain_rating is null or domain_rating between 0 and 100),
  domain_authority numeric(5, 2) check (domain_authority is null or domain_authority between 0 and 100),
  estimated_traffic integer check (estimated_traffic is null or estimated_traffic >= 0),
  website_relevance text,
  outreach_contact text,
  outreach_status public.outreach_status,
  link_attribute public.link_attribute,
  status public.submission_status not null default 'draft',
  current_version integer not null default 0,
  client_approved_version integer,
  first_submitted_at timestamptz,
  last_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index submissions_client_idx on public.backlink_submissions (client_id, status);
create index submissions_campaign_idx on public.backlink_submissions (campaign_id, status);
create index submissions_intern_idx on public.backlink_submissions (intern_id, status);
create index submissions_type_idx on public.backlink_submissions (backlink_type_id);
create index submissions_task_idx on public.backlink_submissions (task_id);
create index submissions_placement_idx on public.backlink_submissions (lower(placement_url));
create trigger submissions_updated_at before update on public.backlink_submissions
  for each row execute function public.set_updated_at();

create table public.submission_versions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.backlink_submissions (id) on delete cascade,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  content_hash text not null,
  is_material_change boolean not null default true,
  change_summary text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (submission_id, version)
);

create table public.submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.backlink_submissions (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index submission_files_submission_idx on public.submission_files (submission_id);

-- Every status change, written by trigger. Reports count the first occurrence of each
-- milestone per submission, so revisions and repeated transitions never inflate totals.
create table public.submission_events (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.backlink_submissions (id) on delete cascade,
  from_status public.submission_status,
  to_status public.submission_status not null,
  version integer,
  actor_id uuid,
  note text,
  occurred_at timestamptz not null default clock_timestamp()
);
create index submission_events_submission_idx on public.submission_events (submission_id, to_status, occurred_at);
create index submission_events_time_idx on public.submission_events (occurred_at);

create table public.internal_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.backlink_submissions (id) on delete cascade,
  version integer not null,
  reviewer_id uuid not null references public.profiles (id),
  reviewer_name text not null,
  decision public.review_decision not null,
  comments text,
  checklist jsonb not null default '{}'::jsonb,
  -- Medical review (only meaningful for medical campaigns; never auto-filled).
  medical_accuracy_reviewed boolean,
  medical_reviewer_name text,
  medical_reviewer_qualification text,
  claims_verified boolean,
  sources_checked boolean,
  compliance_notes text,
  medical_review_date date,
  created_at timestamptz not null default now()
);
create index internal_reviews_submission_idx on public.internal_reviews (submission_id, created_at);

create table public.client_approvals (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.backlink_submissions (id) on delete cascade,
  client_id uuid not null references public.clients (id),
  version integer not null,
  decided_by uuid not null references public.profiles (id),
  decided_by_name text not null,
  decision public.review_decision not null,
  feedback text,
  -- Admin overrides are recorded as such; they are never presented as a client decision.
  is_admin_override boolean not null default false,
  created_at timestamptz not null default now(),
  check (decision = 'approved' or length(trim(coalesce(feedback, ''))) > 0)
);
create index client_approvals_submission_idx on public.client_approvals (submission_id, created_at);
create index client_approvals_client_idx on public.client_approvals (client_id, created_at);

-- ---------------------------------------------------------------------------
-- Publication & verification
-- ---------------------------------------------------------------------------
create table public.published_backlinks (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.backlink_submissions (id) on delete restrict,
  client_id uuid not null references public.clients (id),
  campaign_id uuid not null references public.campaigns (id),
  intern_id uuid not null references public.profiles (id),
  backlink_type_id uuid not null references public.backlink_types (id),
  published_url text not null,
  normalized_published_url text not null,
  publisher_domain text not null,
  target_url text not null,
  normalized_target_url text not null,
  anchor_text text,
  link_attribute public.link_attribute not null default 'unknown',
  publication_date date not null,
  live_status public.live_status not null default 'pending_verification',
  last_checked_at timestamptz,
  first_verified_live_at timestamptz,
  recorded_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One placement (page -> target) is one backlink, however many submissions mention it.
  unique (normalized_published_url, normalized_target_url)
);
create index published_client_idx on public.published_backlinks (client_id);
create index published_campaign_idx on public.published_backlinks (campaign_id);
create index published_status_idx on public.published_backlinks (live_status, last_checked_at);
create trigger published_updated_at before update on public.published_backlinks
  for each row execute function public.set_updated_at();

create table public.verification_checks (
  id uuid primary key default gen_random_uuid(),
  published_backlink_id uuid not null references public.published_backlinks (id) on delete cascade,
  method public.verification_method not null,
  result public.verification_result not null,
  http_status integer,
  final_url text,
  link_found boolean,
  found_anchor_text text,
  found_rel text[],
  detected_attribute public.link_attribute,
  robots_allowed boolean,
  response_time_ms integer,
  error text,
  notes text,
  checked_by uuid references public.profiles (id),
  checked_at timestamptz not null default now()
);
create index verification_checks_backlink_idx on public.verification_checks (published_backlink_id, checked_at desc);

-- ---------------------------------------------------------------------------
-- Notifications, logs, settings, reports, saved filters, rate limits
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  entity_type text,
  entity_id uuid,
  dedupe_key text,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notifications_dedupe_key on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_role public.app_role,
  action text not null,
  entity_type text not null,
  entity_id text,
  client_id uuid,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index activity_logs_time_idx on public.activity_logs (created_at desc);
create index activity_logs_entity_idx on public.activity_logs (entity_type, entity_id);
create index activity_logs_actor_idx on public.activity_logs (actor_id, created_at desc);

create table public.application_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  kind public.report_kind not null,
  client_id uuid references public.clients (id) on delete restrict,
  title text not null,
  period_start date not null,
  period_end date not null,
  timezone text not null,
  filters jsonb not null default '{}'::jsonb,
  data jsonb not null,
  status public.report_status not null default 'draft',
  generated_by uuid references public.profiles (id),
  is_scheduled boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index reports_client_idx on public.reports (client_id, status, period_start desc);

create table public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  page text not null,
  name text not null,
  query text not null,
  created_at timestamptz not null default now(),
  unique (user_id, page, name)
);

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);
